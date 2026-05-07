import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional,
  IsString, Max, MaxLength, Min,
} from 'class-validator';
import { FeeType } from 'src/modules/fees/entities/fee-rule.entity';
import { FraudAction, FraudRuleType } from 'src/modules/fraud/entities/fraud.entity';
import { KycTier } from 'src/modules/users/entities/user.entity';

// ── User management ──────────────────────────────────────────────────────────

export class SuspendUserDto {
  @ApiProperty({ example: 'Suspicious transaction activity detected', description: 'Reason for suspension (logged to audit trail)' })
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason: string;
}

export class OverrideKycTierDto {
  @ApiProperty({ example: 2, enum: [0, 1, 2, 3], description: 'KYC tier to set for this user' })
  @IsInt() @Min(0) @Max(3)
  tier: KycTier;

  @ApiProperty({ example: 'Manual override after in-person verification', description: 'Reason (logged to audit trail)' })
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason: string;
}

// ── Wallet management ─────────────────────────────────────────────────────────

export class FreezeWalletDto {
  @ApiProperty({ example: 'AML investigation — transaction flagged', description: 'Reason for freeze (logged to audit trail)' })
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason: string;
}

// ── Fee rules ─────────────────────────────────────────────────────────────────

export class CreateFeeRuleDto {
  @ApiProperty({ example: 'NGN Internal Transfer Fee', description: 'Human-readable rule name' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'NGN_INTERNAL_V2', description: 'Unique rule code used for cache keys and lookups' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  ruleCode: string;

  @ApiProperty({ example: 'NGN', description: 'ISO 4217 currency code this rule applies to' })
  @IsString() @IsNotEmpty()
  currency: string;

  @ApiProperty({
    example: 'internal',
    description: 'Transaction type: internal | deposit | withdrawal',
    enum: ['internal', 'deposit', 'withdrawal'],
  })
  @IsString() @IsNotEmpty()
  transactionType: string;

  @ApiProperty({ example: 'tiered', enum: FeeType })
  @IsEnum(FeeType)
  feeType: FeeType;

  @ApiPropertyOptional({
    example: 2500,
    description: 'Flat fee in smallest currency unit (kobo/cents). Used when feeType=flat.',
  })
  @IsOptional() @IsInt() @Min(0)
  flatAmount?: number;

  @ApiPropertyOptional({
    example: 0.015,
    description: 'Fee as a decimal fraction of amount (e.g. 0.015 = 1.5%). Used when feeType=percentage.',
  })
  @IsOptional()
  percentage?: number;

  @ApiPropertyOptional({
    example: 5000,
    description: 'Maximum fee cap in smallest unit. null = no cap.',
  })
  @IsOptional() @IsInt() @Min(0)
  cap?: number;

  @ApiPropertyOptional({
    example: 100,
    description: 'Minimum fee floor in smallest unit. null = no floor.',
  })
  @IsOptional() @IsInt() @Min(0)
  floor?: number;

  @ApiPropertyOptional({
    description: 'Tier bands for feeType=tiered. Each band: { minAmount, maxAmount, flatFee }.',
    example: [
      { minAmount: 0,      maxAmount: 500000,  flatFee: 1000 },
      { minAmount: 500001, maxAmount: 5000000, flatFee: 2500 },
      { minAmount: 5000001, maxAmount: null,   flatFee: 5000 },
    ],
    type: 'array',
  })
  @IsOptional()
  tierConfig?: Array<{ minAmount: number; maxAmount: number | null; flatFee: number }>;

  @ApiPropertyOptional({
    example: 0.075,
    description: 'VAT/tax rate applied on top of the fee (e.g. 0.075 = 7.5%). Default 0.',
  })
  @IsOptional()
  taxRate?: number;

  @ApiPropertyOptional({ example: true, description: 'Enable or disable this rule without deleting it' })
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 10, description: 'Higher priority wins when multiple rules match' })
  @IsOptional() @IsInt()
  priority?: number;
}

export class UpdateFeeRuleDto {
  @ApiPropertyOptional({ example: 'NGN Internal Transfer Fee v2' })
  @IsOptional() @IsString() @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 5000, description: 'New fee cap in smallest unit' })
  @IsOptional() @IsInt() @Min(0)
  cap?: number;

  @ApiPropertyOptional({ example: 0.015 })
  @IsOptional()
  percentage?: number;

  @ApiPropertyOptional({ example: 2500 })
  @IsOptional() @IsInt() @Min(0)
  flatAmount?: number;

  @ApiPropertyOptional({ example: 0.075 })
  @IsOptional()
  taxRate?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    example: [
      { minAmount: 0,      maxAmount: 500000,  flatFee: 1000 },
      { minAmount: 500001, maxAmount: null,     flatFee: 2500 },
    ],
    type: 'array',
  })
  @IsOptional()
  tierConfig?: Array<{ minAmount: number; maxAmount: number | null; flatFee: number }>;
}

// ── Fraud rules ───────────────────────────────────────────────────────────────

export class CreateFraudRuleDto {
  @ApiProperty({ example: 'High Velocity — USD', description: 'Human-readable rule name' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'velocity', enum: FraudRuleType })
  @IsEnum(FraudRuleType)
  ruleType: FraudRuleType;

  @ApiPropertyOptional({
    example: 'NGN',
    description: 'Currency this rule applies to. null = all currencies.',
  })
  @IsOptional() @IsString()
  currency?: string | null;

  @ApiPropertyOptional({
    example: null,
    description: 'KYC tier this rule targets. null = all tiers.',
  })
  @IsOptional() @IsInt()
  kycTier?: number | null;

  @ApiProperty({
    description: 'Rule-specific config object. Shape depends on ruleType:\n' +
      '- velocity: `{ maxCount: 10, windowSeconds: 3600 }`\n' +
      '- daily_limit: `{ maxAmount: 5000000 }`\n' +
      '- large_amount: `{ multiplier: 10, minHistory: 5 }`\n' +
      '- unusual_pattern: `{ zScoreThreshold: 3.5 }`',
    example: { maxCount: 10, windowSeconds: 3600 },
  })
  @IsObject()
  config: Record<string, any>;

  @ApiProperty({ example: 'block', enum: FraudAction, description: 'block = reject transaction | flag = allow + alert ops | notify = allow + log' })
  @IsEnum(FraudAction)
  action: FraudAction;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 10, description: 'Higher = checked first' })
  @IsOptional() @IsInt()
  priority?: number;
}

export class UpdateFraudRuleDto {
  @ApiPropertyOptional({ example: false, description: 'Toggle rule on/off without deleting' })
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: { maxCount: 20, windowSeconds: 3600 } })
  @IsOptional() @IsObject()
  config?: Record<string, any>;

  @ApiPropertyOptional({ example: 'flag', enum: FraudAction })
  @IsOptional() @IsEnum(FraudAction)
  action?: FraudAction;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional() @IsInt()
  priority?: number;
}

// ── Fraud alert review ────────────────────────────────────────────────────────

export class ReviewFraudAlertDto {
  @ApiProperty({
    example: 'Confirmed legitimate — user verified via phone call. No further action.',
    description: 'Review notes logged to the alert record',
  })
  @IsString() @IsNotEmpty() @MaxLength(1000)
  notes: string;
}