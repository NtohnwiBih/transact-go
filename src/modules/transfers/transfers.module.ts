import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransfersService } from './transfers.service';
import { TransfersController } from './transfers.controller';
import { Transfer } from './entities/transfer.entity';
import { IdempotencyRecord } from './entities/idempotency-record.entity';
import { WalletsModule } from '../wallets/wallets.module';
import { FeesModule } from '../fees/fees.module';
import { User } from '../users/entities/user.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transfer, IdempotencyRecord, User, Wallet]),
    WalletsModule,
    FeesModule,
  ],
  controllers: [TransfersController],
  providers: [TransfersService, IdempotencyInterceptor],
  exports: [TransfersService, TypeOrmModule],
})
export class TransfersModule {}