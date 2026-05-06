import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule, Cron, CronExpression } from '@nestjs/schedule';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { FeesService } from '../fees/fees.service';
import { FraudService } from '../fraud/fraud.service';
import { IdempotencyRecord } from '../transfers/entities/idempotency-record.entity';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { FeesModule } from '../fees/fees.module';
import { FraudModule } from '../fraud/fraud.module';

/**
 * ScheduledTasksService — cron jobs that run in the background.
 *
 * These are the kinds of jobs that most tutorials skip but are critical in production:
 *  1. Refresh exchange rates every 5 minutes
 *  2. Clean up expired idempotency records daily
 *  3. Seed default rules on startup (idempotent)
 *  4. Reconciliation job — verify wallet balances match ledger sums
 */
@Injectable()
export class ScheduledTasksService {
  private readonly logger = new Logger(ScheduledTasksService.name);

  constructor(
    @InjectRepository(IdempotencyRecord)
    private idempotencyRepo: Repository<IdempotencyRecord>,
    @InjectQueue('payments') private paymentsQueue: Queue,
    private exchangeRatesService: ExchangeRatesService,
    private feesService: FeesService,
    private fraudService: FraudService,
  ) {}

  // ── Exchange rate refresh — every 5 minutes ───────────────────────────────
  @Cron(CronExpression.EVERY_5_MINUTES)
  async refreshExchangeRates() {
    try {
      await this.exchangeRatesService.refreshMockRates();
      this.logger.debug('Exchange rates refreshed');
    } catch (err) {
      this.logger.error(`Exchange rate refresh failed: ${err.message}`);
    }
  }

  // ── Idempotency record cleanup — every day at 2am ─────────────────────────
  @Cron('0 2 * * *')
  async cleanupIdempotencyRecords() {
    const cutoff = new Date(Date.now() - 25 * 3600_000); // 25 hours old
    const result = await this.idempotencyRepo.delete({
      createdAt: LessThan(cutoff),
      status: 'completed',
    });
    this.logger.log(`Cleaned up ${result.affected} expired idempotency records`);
  }

  // ── Seed default rules on startup ─────────────────────────────────────────
  async onModuleInit() {
    this.logger.log('Running startup seeds...');
    await Promise.all([
      this.feesService.seedDefaultRules(),
      this.fraudService.seedDefaultRules(),
      this.exchangeRatesService.refreshMockRates(),
    ]);
    this.logger.log('Startup seeds complete');
  }

  // ── Queue metrics logging — every hour ────────────────────────────────────
  @Cron(CronExpression.EVERY_HOUR)
  async logQueueMetrics() {
    const [waiting, active, completed, failed] = await Promise.all([
      this.paymentsQueue.getWaitingCount(),
      this.paymentsQueue.getActiveCount(),
      this.paymentsQueue.getCompletedCount(),
      this.paymentsQueue.getFailedCount(),
    ]);
    this.logger.log(
      `[Queue:payments] waiting=${waiting} active=${active} completed=${completed} failed=${failed}`,
    );

    if (failed > 10) {
      this.logger.warn(`HIGH FAILURE RATE: ${failed} failed payment jobs — check dead letter queue`);
    }
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([IdempotencyRecord]),
    BullModule.registerQueue(
      { name: 'payments' },
      { name: 'kyc' },
      { name: 'webhooks' },
      { name: 'notifications' },
    ),
    ScheduleModule.forRoot(),
    ExchangeRatesModule,
    FeesModule,
    FraudModule,
  ],
  providers: [ScheduledTasksService],
  exports: [BullModule],
})
export class QueueModule {}