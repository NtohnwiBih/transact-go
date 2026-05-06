import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bull';
import { CacheModule } from '@nestjs/cache-manager';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { KycModule } from './modules/kyc/kyc.module';
import { WalletsModule } from './modules/wallets/wallets.module';
import { TransfersModule } from './modules/transfers/transfers.module';
import { FeesModule } from './modules/fees/fees.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { QueueModule } from './modules/queue/queue.module';
import { FraudModule } from './modules/fraud/fraud.module';
import { ExchangeRatesModule } from './modules/exchange-rates/exchange-rates.module';
import { ReportsModule } from './modules/reports/reports.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuditModule } from './modules/audit/audit.module';
import { AdminModule } from './modules/admin/admin.module';
import { HealthModule } from './modules/health/health.module';

import { User } from './modules/users/entities/user.entity';
import { KycSubmission } from './modules/kyc/entities/kyc-submission.entity';
import { Wallet } from './modules/wallets/entities/wallet.entity';
import { LedgerEntry } from './modules/wallets/entities/ledger-entry.entity';
import { Transfer } from './modules/transfers/entities/transfer.entity';
import { FeeRule } from './modules/fees/entities/fee-rule.entity';
import { IdempotencyRecord } from './modules/transfers/entities/idempotency-record.entity';
import { WebhookEvent } from './modules/webhooks/entities/webhook-event.entity';
import { FraudRule, FraudAlert } from './modules/fraud/entities/fraud.entity';
import { ExchangeRate } from './modules/exchange-rates/entities/exchange-rate.entity';
import { AuditLog } from './modules/audit/entities/audit-log.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'], cache: true }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        type: 'postgres',
        host:     c.get('DB_HOST', 'localhost'),
        port:     c.get<number>('DB_PORT', 5432),
        username: c.get('DB_USERNAME', 'fintech'),
        password: c.get('DB_PASSWORD', 'fintech_secret'),
        database: c.get('DB_NAME', 'fintech_db'),
        entities: [
          User, KycSubmission, Wallet, LedgerEntry,
          Transfer, FeeRule, IdempotencyRecord, WebhookEvent,
          FraudRule, FraudAlert, ExchangeRate, AuditLog,
        ],
        synchronize: c.get('NODE_ENV') !== 'production',
        logging: c.get('DB_LOGGING') === 'true',
        extra: { max: 20, min: 2, idleTimeoutMillis: 30000 },
      }),
    }),

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        redis: {
          host:     c.get('REDIS_HOST', 'localhost'),
          port:     c.get<number>('REDIS_PORT', 6379),
          password: c.get('REDIS_PASSWORD'),
          db: 0,
        },
        defaultJobOptions: { removeOnComplete: 100, removeOnFail: 500 },
      }),
    }),

    CacheModule.register({ isGlobal: true, ttl: 300, max: 1000 }),

    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'burst',  ttl: 1000,      limit: 10   },
        { name: 'medium', ttl: 60000,     limit: 200  },
        { name: 'long',   ttl: 3_600_000, limit: 2000 },
      ],
    }),

    AuditModule,
    NotificationsModule,
    AuthModule,
    UsersModule,
    KycModule,
    WalletsModule,
    FeesModule,
    FraudModule,
    ExchangeRatesModule,
    TransfersModule,
    PaymentsModule,
    WebhooksModule,
    ReportsModule,
    QueueModule,
    AdminModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}