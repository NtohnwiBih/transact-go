import { Process, Processor, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { NotificationPayload, NotificationType } from './notifications.service';

@Processor('notifications')
export class NotificationsProcessor {
  private readonly logger = new Logger(NotificationsProcessor.name);

  @Process('send-notification')
  async handleSendNotification(job: Job<NotificationPayload>): Promise<void> {
    const { userId, type, data, channels = ['email'] } = job.data;

    for (const channel of channels) {
      await this.dispatch(channel, userId, type, data);
    }
  }

  private async dispatch(
    channel: string,
    userId: string,
    type: NotificationType,
    data: Record<string, any>,
  ): Promise<void> {
    // In production: plug in SendGrid (email), Twilio (SMS), Firebase (push)
    // Here we just log — the architecture is the same regardless
    this.logger.log(
      `[${channel.toUpperCase()}] → user=${userId} type=${type} data=${JSON.stringify(data)}`,
    );

    switch (type) {
      case NotificationType.TRANSFER_SENT:
        this.logger.log(
          `  ${channel}: "You sent ${data.formattedAmount} to ${data.to}"`,
        );
        break;
      case NotificationType.TRANSFER_RECEIVED:
        this.logger.log(
          `  ${channel}: "You received ${data.formattedAmount} from ${data.from}"`,
        );
        break;
      case NotificationType.KYC_APPROVED:
        this.logger.log(
          `  ${channel}: "Your KYC Tier ${data.tier} verification was approved!"`,
        );
        break;
      case NotificationType.KYC_REJECTED:
        this.logger.log(
          `  ${channel}: "Your KYC verification was rejected. Please resubmit."`,
        );
        break;
      case NotificationType.FRAUD_ALERT:
        this.logger.warn(
          `  ${channel}: "Security alert: unusual activity detected on your account"`,
        );
        break;
      default:
        this.logger.log(`  ${channel}: notification type=${type}`);
    }

    // Simulate send latency
    await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `Notification job ${job.id} failed after ${job.attemptsMade} attempts: ${error.message}`,
    );
  }
}