import {
  Body, Controller, Get, Param, ParseUUIDPipe,
  Post, UseGuards, UseInterceptors,
} from '@nestjs/common';
import {
  IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaymentsService } from './payments.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { KycGuard, RequiredKycTier } from '../../common/guards/kyc.guard';
import { Idempotent, IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';
import { KycTier } from '../users/entities/user.entity';

class DepositDto {
  @IsUUID() walletId: string;
  @IsInt() @Min(1) @Transform(({ value }) => parseInt(value, 10)) amount: number;
  @IsString() @IsNotEmpty() currency: string;
  @IsEnum(['flutterwave', 'stripe']) provider: 'flutterwave' | 'stripe';
  @IsOptional() @IsString() customerEmail?: string;
}

class WithdrawalDto {
  @IsUUID() walletId: string;
  @IsInt() @Min(1) @Transform(({ value }) => parseInt(value, 10)) amount: number;
  @IsString() @IsNotEmpty() currency: string;
  @IsEnum(['flutterwave', 'stripe']) provider: 'flutterwave' | 'stripe';
  @IsObject() recipientDetails: Record<string, any>;
  @IsOptional() @IsString() narration?: string;
}

@Controller('payments')
@UseGuards(KycGuard)
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  /**
   * POST /api/v1/payments/deposit
   * Initiate an external deposit. Requires KYC Tier 1.
   */
  @Post('deposit')
  @RequiredKycTier(KycTier.TIER_1)
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  deposit(@CurrentUser('id') userId: string, @Body() dto: DepositDto) {
    return this.paymentsService.initiateDeposit(userId, dto);
  }

  /**
   * POST /api/v1/payments/withdraw
   * Initiate an external withdrawal. Requires KYC Tier 2.
   */
  @Post('withdraw')
  @RequiredKycTier(KycTier.TIER_2)
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  withdraw(@CurrentUser('id') userId: string, @Body() dto: WithdrawalDto) {
    return this.paymentsService.initiateWithdrawal(userId, dto);
  }
}