import { Controller, Get, Param, Query } from '@nestjs/common';
import { ExchangeRatesService } from './exchange-rates.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('exchange-rates')
export class ExchangeRatesController {
  constructor(private ratesService: ExchangeRatesService) {}

  /** GET /api/v1/exchange-rates — list all live rates */
  @Get()
  getAllRates() {
    return this.ratesService.getAllCurrentRates();
  }

  /** GET /api/v1/exchange-rates/convert?from=NGN&to=USD&amount=100000 */
  @Get('convert')
  convert(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('amount') amount: string,
  ) {
    return this.ratesService.convert(parseInt(amount, 10), from.toUpperCase(), to.toUpperCase());
  }

  /** GET /api/v1/exchange-rates/:from/:to */
  @Get(':from/:to')
  getRate(@Param('from') from: string, @Param('to') to: string) {
    return this.ratesService.getRate(from.toUpperCase(), to.toUpperCase());
  }
}