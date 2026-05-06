import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { Transfer, TransferStatus, TransferType } from './entities/transfer.entity';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { KycGuard, RequiredKycTier } from '../../common/guards/kyc.guard';
import { Idempotent, IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';
import { IsString, IsNumber, IsOptional, IsUUID, Min, IsNotEmpty, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { KycTier } from '../users/entities/user.entity';

class InternalTransferBodyDto {
  @IsUUID()
  sourceWalletId: string;

  @IsUUID()
  destinationWalletId: string;

  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10))
  amount: number; // in smallest unit (kobo, cents)

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  narration?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;
}

@Controller('transfers')
@UseGuards(KycGuard)
export class TransfersController {
  constructor(private transfersService: TransfersService) {}

  /**
   * POST /api/v1/transfers/internal
   */
  @Post('internal')
  @RequiredKycTier(KycTier.TIER_1)
  @Idempotent()
  @UseInterceptors(IdempotencyInterceptor)
  async internalTransfer(
    @CurrentUser('id') userId: string,
    @Body() dto: InternalTransferBodyDto,
  ): Promise<Transfer> {
    return this.transfersService.internalTransfer(userId, dto);
  }

  /**
   * GET /api/v1/transfers
   * Paginated transfer history for the authenticated user.
   */
  @Get()
  async getHistory(
    @CurrentUser('id') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status') status?: TransferStatus,
    @Query('type') type?: TransferType,
  ) {
    return this.transfersService.getTransferHistory(userId, { page, limit, status, type });
  }

  /**
   * GET /api/v1/transfers/:id
   * Get a single transfer by ID.
   */
  @Get(':id')
  async getTransfer(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<Transfer> {
    return this.transfersService.getTransferById(id, userId);
  }
}