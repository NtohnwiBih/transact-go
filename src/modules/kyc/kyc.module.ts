import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { KycSubmission } from './entities/kyc-submission.entity';
import { User } from '../users/entities/user.entity';
import { KycService } from './kyc.service';
import { KycController } from './kyc.controller';
import { KycProcessor } from './kyc.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([KycSubmission, User]),
    BullModule.registerQueue({ name: 'kyc' }),
  ],
  controllers: [KycController],
  providers: [KycService, KycProcessor],
  exports: [KycService],
})
export class KycModule {}