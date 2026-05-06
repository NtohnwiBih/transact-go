import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { WebhooksController } from './webhooks.controller';
import { WebhooksProcessor } from './webhooks.processor';
import { WebhookEvent } from './entities/webhook-event.entity';
import { Transfer } from '../transfers/entities/transfer.entity';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookEvent, Transfer]),
    BullModule.registerQueue({ name: 'webhooks' }),
    PaymentsModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksProcessor],
})
export class WebhooksModule {}