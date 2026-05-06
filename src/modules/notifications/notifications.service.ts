import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';

export enum NotificationType {
  TRANSFER_SENT     = 'transfer_sent',
  TRANSFER_RECEIVED = 'transfer_received',
  TRANSFER_FAILED   = 'transfer_failed',
  KYC_APPROVED      = 'kyc_approved',
  KYC_REJECTED      = 'kyc_rejected',
  LOGIN_NEW_DEVICE  = 'login_new_device',
  FRAUD_ALERT       = 'fraud_alert',
  DAILY_SUMMARY     = 'daily_summary',
}

export interface NotificationPayload {
  userId: string;
  type: NotificationType;
  data: Record<string, any>;
  channels?: Array<'email' | 'sms' | 'push'>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectQueue('notifications') private notifQueue: Queue,
  ) {}

  /**
   * Queue a notification for async delivery.
   * Never send notifications synchronously in request handlers.
   */
  async send(payload: NotificationPayload): Promise<void> {
    await this.notifQueue.add('send-notification', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
    });
  }

  async sendTransferSent(userId: string, amount: number, currency: string, to: string) {
    return this.send({
      userId,
      type: NotificationType.TRANSFER_SENT,
      data: { amount, currency, to, formattedAmount: `${currency} ${(amount / 100).toFixed(2)}` },
      channels: ['email', 'push'],
    });
  }

  async sendTransferReceived(userId: string, amount: number, currency: string, from: string) {
    return this.send({
      userId,
      type: NotificationType.TRANSFER_RECEIVED,
      data: { amount, currency, from, formattedAmount: `${currency} ${(amount / 100).toFixed(2)}` },
      channels: ['email', 'push'],
    });
  }

  async sendKycResult(userId: string, approved: boolean, tier: number) {
    return this.send({
      userId,
      type: approved ? NotificationType.KYC_APPROVED : NotificationType.KYC_REJECTED,
      data: { tier, approved },
      channels: ['email', 'push'],
    });
  }

  async sendFraudAlert(userId: string, rule: string, amount: number, currency: string) {
    return this.send({
      userId,
      type: NotificationType.FRAUD_ALERT,
      data: { rule, amount, currency },
      channels: ['email', 'push'],
    });
  }
}