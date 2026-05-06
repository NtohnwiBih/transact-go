import {
  BadRequestException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { Transfer, TransferStatus, TransferType } from '../transfers/entities/transfer.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import { User } from '../users/entities/user.entity';
import { FeesService } from '../fees/fees.service';
import { FraudService } from '../fraud/fraud.service';
import { WalletsService } from '../wallets/wallets.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';
import { EntryCategory } from '../wallets/entities/ledger-entry.entity';
import { MockFlutterwaveProvider, MockStripeProvider } from './providers/mock-providers';

export class InitiateDepositDto {
  walletId: string;
  amount: number;
  currency: string;
  provider: 'flutterwave' | 'stripe';
  customerEmail?: string;
  metadata?: Record<string, any>;
}

export class InitiateWithdrawalDto {
  walletId: string;
  amount: number;
  currency: string;
  provider: 'flutterwave' | 'stripe';
  recipientDetails: {
    accountNumber?: string;
    bankCode?: string;
    accountName?: string;
    bankName?: string;
    routingNumber?: string;
  };
  narration?: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Transfer)   private transferRepo: Repository<Transfer>,
    @InjectRepository(Wallet)     private walletRepo: Repository<Wallet>,
    @InjectRepository(User)       private userRepo: Repository<User>,
    @InjectQueue('payments')      private paymentQueue: Queue,
    private feesService: FeesService,
    private fraudService: FraudService,
    private walletsService: WalletsService,
    private notificationsService: NotificationsService,
    private auditService: AuditService,
    private flutterwaveProvider: MockFlutterwaveProvider,
    private stripeProvider: MockStripeProvider,
    private dataSource: DataSource,
  ) {}

  /**
   * Initiate an external deposit.
   * Creates a pending transfer, queues the provider call, returns immediately.
   * Completion is handled via webhook or job result.
   */
  async initiateDeposit(userId: string, dto: InitiateDepositDto): Promise<Transfer> {
    const wallet = await this.walletRepo.findOne({ where: { id: dto.walletId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.userId !== userId) throw new BadRequestException('Access denied');

    if (wallet.currency !== dto.currency) {
      throw new BadRequestException(`Wallet currency is ${wallet.currency}, not ${dto.currency}`);
    }

    if (dto.amount <= 0) throw new BadRequestException('Amount must be positive');

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found'); // ✅ FIX

    await this.fraudService.evaluate({
      userId,
      amount: dto.amount,
      currency: dto.currency,
      kycTier: user.kycTier,
    });

    const feeBreakdown = await this.feesService.calculate({
      amount: dto.amount,
      currency: dto.currency,
      transactionType: 'deposit',
    });

    const transfer = await this.transferRepo.save(
      this.transferRepo.create({
        userId,
        type: TransferType.DEPOSIT,
        status: TransferStatus.PENDING,
        currency: dto.currency,
        amount: dto.amount,
        fee: feeBreakdown.totalFee,
        feeBreakdown: feeBreakdown as any,
        destinationWalletId: dto.walletId,
        provider: dto.provider,
        narration: `Deposit via ${dto.provider}`,
      }),
    );

    await this.paymentQueue.add(
      'process-deposit',
      {
        transferId: transfer.id,
        userId,
        walletId: dto.walletId,
        amount: dto.amount,
        currency: dto.currency,
        provider: dto.provider,
        customerEmail: dto.customerEmail ?? user.email,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    this.auditService.log({
      action: AuditAction.TRANSFER_INIT,
      userId,
      resourceType: 'transfer',
      resourceId: transfer.id,
      metadata: { type: 'deposit', amount: dto.amount, provider: dto.provider },
    });

    this.logger.log(`Deposit initiated: ${transfer.id}`);
    return transfer;
  }

  /**
   * Initiate an external withdrawal.
   * Debits wallet immediately (held), queues provider disbursement.
   */
  async initiateWithdrawal(userId: string, dto: InitiateWithdrawalDto): Promise<Transfer> {
    const wallet = await this.walletRepo.findOne({ where: { id: dto.walletId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.userId !== userId) throw new BadRequestException('Access denied');

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found'); // ✅ FIX

    await this.fraudService.evaluate({
      userId,
      amount: dto.amount,
      currency: dto.currency,
      kycTier: user.kycTier,
    });

    const feeBreakdown = await this.feesService.calculate({
      amount: dto.amount,
      currency: dto.currency,
      transactionType: 'withdrawal',
    });

    const totalDebit = dto.amount + feeBreakdown.totalFee;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const transfer = await queryRunner.manager.save(
        queryRunner.manager.create(Transfer, {
          userId,
          type: TransferType.WITHDRAWAL,
          status: TransferStatus.PROCESSING,
          currency: dto.currency,
          amount: dto.amount,
          fee: feeBreakdown.totalFee,
          feeBreakdown: feeBreakdown as any,
          sourceWalletId: dto.walletId,
          provider: dto.provider,
          recipientDetails: dto.recipientDetails,
          narration: dto.narration ?? `Withdrawal via ${dto.provider}`, // safe default
        }),
      );

      await this.walletsService.debit(
        {
          walletId: dto.walletId,
          userId,
          amount: totalDebit,
          category: EntryCategory.WITHDRAWAL,
          narration: transfer.narration ?? `Withdrawal via ${dto.provider}`, // ✅ FIX
          transferId: transfer.id,
          metadata: { feeBreakdown, provider: dto.provider },
        },
        queryRunner,
      );

      await queryRunner.commitTransaction();

      await this.paymentQueue.add(
        'process-withdrawal',
        {
          transferId: transfer.id,
          userId,
          amount: dto.amount,
          currency: dto.currency,
          provider: dto.provider,
          recipientDetails: dto.recipientDetails,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );

      this.auditService.log({
        action: AuditAction.TRANSFER_INIT,
        userId,
        resourceType: 'transfer',
        resourceId: transfer.id,
        metadata: { type: 'withdrawal', amount: dto.amount, provider: dto.provider },
      });

      return transfer;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
  /** Called by payment processor or webhook handler when a deposit completes */
  async completeDeposit(
    transferId: string,
    providerReference: string,
    providerResponse: Record<string, any>,
  ): Promise<void> {
    const transfer = await this.transferRepo.findOne({ where: { id: transferId } });
    if (!transfer || transfer.status !== TransferStatus.PENDING) return;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await this.walletsService.credit(
        {
          walletId: transfer.destinationWalletId!,
          amount: transfer.amount - transfer.fee,
          category: EntryCategory.DEPOSIT,
          narration: `Deposit via ${transfer.provider}`,
          transferId: transfer.id,
          providerReference,
          metadata: { provider: transfer.provider },
        },
        queryRunner,
      );

      await queryRunner.manager.update(Transfer, transferId, {
        status: TransferStatus.COMPLETED,
        providerReference,
        providerResponse,
        completedAt: new Date(),
      });

      await queryRunner.commitTransaction();

      await this.notificationsService.sendTransferReceived(
        transfer.userId, transfer.amount, transfer.currency, transfer.provider ?? 'unknown',
      );

      this.auditService.log({
        action: AuditAction.TRANSFER_COMPLETE,
        userId: transfer.userId,
        resourceType: 'transfer',
        resourceId: transferId,
        metadata: { type: 'deposit', providerReference },
      });

    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  getProvider(name: string): MockFlutterwaveProvider | MockStripeProvider {
    if (name === 'flutterwave') return this.flutterwaveProvider;
    if (name === 'stripe') return this.stripeProvider;
    throw new BadRequestException(`Unknown provider: ${name}`);
  }
}