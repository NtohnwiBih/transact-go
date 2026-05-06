import { Process, Processor, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Job } from 'bull';
import { WebhookEvent, WebhookStatus } from './entities/webhook-event.entity';
import { PaymentsService } from '../payments/payments.service';
import { Transfer, TransferStatus } from '../transfers/entities/transfer.entity';

interface WebhookJobData {
  webhookEventId: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  payload: any;
}

@Processor('webhooks')
export class WebhooksProcessor {
  private readonly logger = new Logger(WebhooksProcessor.name);

  constructor(
    @InjectRepository(WebhookEvent) private webhookRepo: Repository<WebhookEvent>,
    @InjectRepository(Transfer) private transferRepo: Repository<Transfer>,
    private paymentsService: PaymentsService,
  ) {}

  @Process('process-flutterwave-event')
  async handleFlutterwaveEvent(job: Job<WebhookJobData>): Promise<void> {
    const { webhookEventId, payload } = job.data;
    await this.processEvent(webhookEventId, payload, this.parseFlwEvent(payload));
  }

  @Process('process-stripe-event')
  async handleStripeEvent(job: Job<WebhookJobData>): Promise<void> {
    const { webhookEventId, payload } = job.data;
    await this.processEvent(webhookEventId, payload, this.parseStripeEvent(payload));
  }

  private async processEvent(
    webhookEventId: string,
    payload: any,
    parsed: { reference: string; status: string; type: string },
  ): Promise<void> {
    await this.webhookRepo.update(webhookEventId, {
      status: WebhookStatus.PROCESSING,
      attempts: () => '"attempts" + 1',
    });

    const transfer = await this.transferRepo.findOne({
      where: [
        { id: parsed.reference },
        { providerReference: parsed.reference },
      ],
    });

    if (!transfer) {
      this.logger.warn(`Webhook: no transfer found for reference ${parsed.reference}`);
      await this.webhookRepo.update(webhookEventId, { status: WebhookStatus.COMPLETED });
      return;
    }

    if (transfer.status === TransferStatus.COMPLETED || transfer.status === TransferStatus.FAILED) {
      this.logger.debug(`Webhook: transfer ${transfer.id} already in terminal state`);
      await this.webhookRepo.update(webhookEventId, { status: WebhookStatus.COMPLETED });
      return;
    }

    if (parsed.status === 'success' && transfer.status === TransferStatus.PROCESSING) {
      if (transfer.type === 'deposit') {
        await this.paymentsService.completeDeposit(
          transfer.id,
          parsed.reference,
          payload,
        );
      } else {
        await this.transferRepo.update(transfer.id, {
          status: TransferStatus.COMPLETED,
          providerResponse: payload,
          completedAt: new Date(),
        });
      }
    } else if (parsed.status === 'failed') {
      await this.transferRepo.update(transfer.id, {
        status: TransferStatus.FAILED,
        failureReason: 'Payment failed via webhook notification',
        providerResponse: payload,
      });
    }

    await this.webhookRepo.update(webhookEventId, {
      status: WebhookStatus.COMPLETED,
      processedAt: new Date(),
    });

    this.logger.log(`Webhook processed: ${webhookEventId} → transfer ${transfer.id} → ${parsed.status}`);
  }

  private parseFlwEvent(payload: any) {
    return {
      type: payload?.event || 'charge.completed',
      reference: payload?.data?.tx_ref || payload?.data?.id,
      status: payload?.data?.status === 'successful' ? 'success' : payload?.data?.status,
    };
  }

  private parseStripeEvent(payload: any) {
    return {
      type: payload?.type || 'payment_intent.succeeded',
      reference: payload?.data?.object?.metadata?.reference || payload?.data?.object?.id,
      status: ['succeeded', 'paid'].includes(payload?.data?.object?.status) ? 'success' : 'failed',
    };
  }

  @OnQueueFailed()
  async onFailed(job: Job<WebhookJobData>, error: Error): Promise<void> {
    this.logger.error(`Webhook job ${job.id} failed: ${error.message}`);
    if (job.attemptsMade >= (job.opts.attempts ?? 5)) {
      await this.webhookRepo.update(job.data.webhookEventId, {
        status: WebhookStatus.FAILED,
        errorMessage: error.message,
      });
    }
  }
}