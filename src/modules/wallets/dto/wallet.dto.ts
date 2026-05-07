import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { Currency } from '../entities/wallet.entity';

export class CreateWalletDto {
  @ApiProperty({
    example: 'NGN',
    description: 'ISO 4217 currency code',
    enum: Currency,
  })
  @IsEnum(Currency)
  currency: Currency;

  @ApiPropertyOptional({ example: 'My Savings', description: 'Optional label for this wallet' })
  @IsOptional() @IsString() @MaxLength(100)
  label?: string;
}