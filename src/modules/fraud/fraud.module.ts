import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FraudRule, FraudAlert } from './entities/fraud.entity';
import { FraudService } from './fraud.service';
import { LedgerEntry } from '../wallets/entities/ledger-entry.entity';
import { Transfer } from '../transfers/entities/transfer.entity';

@Module({
  imports: [TypeOrmModule.forFeature([FraudRule, FraudAlert, LedgerEntry, Transfer])],
  providers: [FraudService],
  exports: [FraudService],
})
export class FraudModule {}