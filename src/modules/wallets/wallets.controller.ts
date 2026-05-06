import {
  Body, Controller, Get, Param, ParseUUIDPipe,
  Post, Query, ParseIntPipe, DefaultValuePipe,
} from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Currency } from './entities/wallet.entity';
import { EntryCategory } from './entities/ledger-entry.entity';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

class CreateWalletDto {
  @IsEnum(Currency)
  currency: Currency;

  @IsOptional() @IsString() @MaxLength(100)
  label?: string;
}

@Controller('wallets')
export class WalletsController {
  constructor(private walletsService: WalletsService) {}

  @Post()
  createWallet(@CurrentUser('id') userId: string, @Body() dto: CreateWalletDto) {
    return this.walletsService.createWallet(userId, dto.currency);
  }

  @Get()
  getWallets(@CurrentUser('id') userId: string) {
    return this.walletsService.getUserWallets(userId);
  }

  @Get(':id')
  getWallet(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.walletsService.getWallet(id, userId);
  }

  @Get(':id/ledger')
  getLedger(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('category') category?: EntryCategory,
  ) {
    return this.walletsService.getLedger(id, userId, { page, limit, category });
  }
}