import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, Max } from 'class-validator';
import { DocumentType } from '../entities/kyc-submission.entity';
import { KycTier } from '../../users/entities/user.entity';

export class SubmitKycDto {
  @ApiProperty({
    example: 1,
    description: 'Target KYC tier to upgrade to (1, 2, or 3)',
    enum: [1, 2, 3],
  })
  @IsInt()
  @Min(1)
  @Max(3)
  targetTier: KycTier;

  @ApiProperty({
    example: 'bvn',
    description: 'Type of identity document being submitted',
    enum: DocumentType,
  })
  @IsEnum(DocumentType)
  documentType: DocumentType;

  @ApiPropertyOptional({
    example: '12345678901',
    description: 'BVN, NIN, or document ID number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  documentNumber?: string;

  @ApiPropertyOptional({
    example: 'docs/passport-scan.pdf',
    description: 'S3/GCS reference to uploaded document (for Tier 2+)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  documentReference?: string;
}