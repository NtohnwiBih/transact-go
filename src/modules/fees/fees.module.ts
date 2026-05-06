import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeesService } from './fees.service';
import { FeeRule } from './entities/fee-rule.entity';

@Module({
  imports: [TypeOrmModule.forFeature([FeeRule])],
  providers: [FeesService],
  exports: [FeesService],
})
export class FeesModule {}