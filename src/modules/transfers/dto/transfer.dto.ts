import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsNumber, IsOptional, IsUUID, Min, IsNotEmpty, MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class InternalTransferDto {
  @ApiProperty({
    example: 'd4b6b035-e56f-46ba-ac78-b1bf52368655',
    description: "UUID of the sender's wallet",
  })
  @IsUUID()
  sourceWalletId: string;

  @ApiProperty({
    example: '3a610987-51a2-4cff-a517-cef2b7744255',
    description: "UUID of the recipient's wallet",
  })
  @IsUUID()
  destinationWalletId: string;

  @ApiProperty({
    example: 1000000,
    description: 'Amount in smallest currency unit (kobo for NGN, cents for USD). ₦10,000 = 1000000 kobo.',
    minimum: 1,
  })
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10))
  amount: number;

  @ApiProperty({ example: 'NGN', description: 'Must match the source wallet currency' })
  @IsString() @IsNotEmpty()
  currency: string;

  @ApiPropertyOptional({ example: 'Lunch money', maxLength: 255 })
  @IsOptional() @IsString() @MaxLength(255)
  narration?: string;

  @ApiPropertyOptional({ example: 'INV-2024-001', description: 'Your internal reference', maxLength: 100 })
  @IsOptional() @IsString() @MaxLength(100)
  reference?: string;
}