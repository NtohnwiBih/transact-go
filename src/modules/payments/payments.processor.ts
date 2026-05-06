import {
  OnQueueFailed, Process, Processor,
} from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Job } from 'bull';
import { Transfer, TransferStatus } from '../transfers/entities/transfer.entity';
import { PaymentsService } from './payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';

interface DepositJobData {
  transferId: string;
  userId: string;
  walletId: string;
  amount: number;
  currency: string;
  provider: string;
  customerEmail: string;
}

interface WithdrawalJobData {
  transferId: string;
  userId: string;
  amount: number;
  currency: string;
  provider: string;
  recipientDetails: Record<string, any>;
}

@Processor('payments')
export class PaymentsProcessor {
  private readonly logger = new Logger(PaymentsProcessor.name);

  constructor(
    @InjectRepository(Transfer) private transferRepo: Repository<Transfer>,
    private paymentsService: PaymentsService,
    private notificationsService: NotificationsService,
    private auditService: AuditService,
  ) {}

  @Process({ name: 'process-deposit', concurrency: 5 })
  async handleDeposit(job: Job<DepositJobData>): Promise<void> {
    const { transferId, userId, walletId, amount, currency, provider, customerEmail } = job.data;
    job.log(`Processing deposit: ${transferId} via ${provider}`);

    // Update status to processing
    await this.transferRepo.update(transferId, {
      status: TransferStatus.PROCESSING,
      attempts: job.attemptsMade + 1,
    });

    const providerInstance = this.paymentsService.getProvider(provider);

    const result = await providerInstance.charge({
      amount, currency,
      reference: transferId,
      customerEmail,
      metadata: { transferId, userId },
    });

    if (result.status === 'success') {
      await this.paymentsService.completeDeposit(
        transferId,
        result.providerReference,
        result.rawResponse,
      );
      job.log(`Deposit completed: ${result.providerReference}`);

    } else if (result.status === 'pending') {
      // Provider will notify us via webhook — update record and wait
      await this.transferRepo.update(transferId, {
        status: TransferStatus.PROCESSING,
        providerReference: result.providerReference,
        providerResponse: result.rawResponse,
      });
      job.log(`Deposit pending provider confirmation: ${result.providerReference}`);

    } else {
      await this.transferRepo.update(transferId, {
        status: TransferStatus.FAILED,
        failureReason: result.message,
        providerResponse: result.rawResponse,
        completedAt: new Date(),
      });
      this.auditService.log({
        action: AuditAction.TRANSFER_FAIL,
        userId,
        resourceType: 'transfer',
        resourceId: transferId,
        metadata: { provider, reason: result.message },
      });
      throw new Error(`Deposit failed: ${result.message}`); // triggers retry
    }
  }

  @Process({ name: 'process-withdrawal', concurrency: 3 })
  async handleWithdrawal(job: Job<WithdrawalJobData>): Promise<void> {
    const { transferId, userId, amount, currency, provider, recipientDetails } = job.data;
    job.log(`Processing withdrawal: ${transferId} via ${provider}`);

    const providerInstance = this.paymentsService.getProvider(provider);

    const result = await providerInstance.charge({
      amount, currency,
      reference: transferId,
      metadata: { transferId, userId, type: 'withdrawal', recipientDetails },
    });

    if (result.status === 'success') {
      await this.transferRepo.update(transferId, {
        status: TransferStatus.COMPLETED,
        providerReference: result.providerReference,
        providerResponse: result.rawResponse,
        completedAt: new Date(),
      });

      await this.notificationsService.sendTransferSent(
        userId, amount, currency, JSON.stringify(recipientDetails),
      );
      job.log(`Withdrawal completed: ${result.providerReference}`);

    } else {
      // Withdrawal failed AFTER debit — must reverse wallet debit
      // In production: this triggers a reversal workflow
      await this.transferRepo.update(transferId, {
        status: TransferStatus.FAILED,
        failureReason: result.message,
        providerResponse: result.rawResponse,
      });
      throw new Error(`Withdrawal disbursement failed: ${result.message}`);
    }
  }

  @OnQueueFailed()
  async onFailed(job: Job, error: Error): Promise<void> {
    this.logger.error(
      `Payment job '${job.name}' (${job.id}) failed after ${job.attemptsMade} attempts: ${error.message}`,
    );

    // After max retries exhausted, mark transfer as permanently failed
    if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
      const transferId = job.data?.transferId;
      if (transferId) {
        await this.transferRepo.update(transferId, {
          status: TransferStatus.FAILED,
          failureReason: `Max retries exceeded: ${error.message}`,
        });
        this.logger.error(`Transfer ${transferId} permanently failed — manual review required`);
      }
    }
  }
}