import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaymentsProcessor } from './payments.processor';
import { MockFlutterwaveProvider, MockStripeProvider } from './providers/mock-providers';
import { Transfer } from '../transfers/entities/transfer.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import { User } from '../users/entities/user.entity';
import { WalletsModule } from '../wallets/wallets.module';
import { FeesModule } from '../fees/fees.module';
import { FraudModule } from '../fraud/fraud.module';
import { IdempotencyRecord } from '../transfers/entities/idempotency-record.entity';
import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transfer, Wallet, User, IdempotencyRecord]),
    BullModule.registerQueue({ name: 'payments' }),
    WalletsModule,
    FeesModule,
    FraudModule,
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentsProcessor,
    MockFlutterwaveProvider,
    MockStripeProvider,
    IdempotencyInterceptor,
  ],
  exports: [PaymentsService, MockFlutterwaveProvider, MockStripeProvider],
})
export class PaymentsModule {}