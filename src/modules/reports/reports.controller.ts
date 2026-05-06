import {
  Controller, Get, Param, ParseUUIDPipe, Query,
} from '@nestjs/common';
import { ReportsService } from './reports.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  /**
   * GET /api/v1/reports/statement/:walletId?from=2024-01-01&to=2024-03-31
   */
  @Get('statement/:walletId')
  getStatement(
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @CurrentUser('id') userId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400_000);
    const toDate   = to   ? new Date(to)   : new Date();
    return this.reportsService.generateStatement(walletId, userId, fromDate, toDate);
  }

  /**
   * GET /api/v1/reports/summary?from=2024-01-01&to=2024-03-31
   */
  @Get('summary')
  getSummary(
    @CurrentUser('id') userId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400_000);
    const toDate   = to   ? new Date(to)   : new Date();
    return this.reportsService.getUserSummary(userId, fromDate, toDate);
  }
}