import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { ExchangeRate } from './entities/exchange-rate.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';

export interface ConversionResult {
  fromAmount: number;
  toAmount: number;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  spread: number;
  effectiveRate: number;   // rate after spread applied
  rateId: string;
  expiresAt: Date;
}

@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name);

  // Hardcoded mock rates — in production: fetch from Open Exchange Rates, Fixer.io etc.
  private readonly MOCK_RATES: Record<string, number> = {
    'NGN/USD': 0.00065,    // ₦1 = $0.00065 (≈ ₦1,540/$)
    'USD/NGN': 1540.0,
    'NGN/GHS': 0.075,
    'GHS/NGN': 13.33,
    'USD/GHS': 15.5,
    'GHS/USD': 0.0645,
    'USD/EUR': 0.921,
    'EUR/USD': 1.086,
    'USD/GBP': 0.789,
    'GBP/USD': 1.268,
    'NGN/EUR': 0.00060,
    'EUR/NGN': 1666.0,
    'USD/KES': 129.5,
    'KES/USD': 0.0077,
  };

  constructor(
    @InjectRepository(ExchangeRate) private rateRepo: Repository<ExchangeRate>,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  async getRate(fromCurrency: string, toCurrency: string): Promise<ExchangeRate> {
    if (fromCurrency === toCurrency) {
      // Synthetic 1:1 rate for same-currency
      return {
        id: 'same-currency',
        fromCurrency,
        toCurrency,
        rate: 1,
        spread: 0,
        source: 'identity',
        validAt: new Date(),
        expiresAt: new Date(Date.now() + 86400_000),
        createdAt: new Date(),
      } as ExchangeRate;
    }

    const cacheKey = `rate:${fromCurrency}:${toCurrency}`;
    const cached = await this.cache.get<ExchangeRate>(cacheKey);
    if (cached) return cached;

    // Try DB first (from previous refresh cycle)
    const dbRate = await this.rateRepo.findOne({
      where: {
        fromCurrency,
        toCurrency,
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
    });

    if (dbRate) {
      await this.cache.set(cacheKey, dbRate, 60_000);
      return dbRate;
    }

    // Fall back to mock rates
    return this.upsertMockRate(fromCurrency, toCurrency);
  }

  async convert(
    fromAmount: number,
    fromCurrency: string,
    toCurrency: string,
  ): Promise<ConversionResult> {
    const rate = await this.getRate(fromCurrency, toCurrency);

    const spreadMultiplier = fromCurrency !== toCurrency ? (1 - Number(rate.spread)) : 1;
    const effectiveRate = Number(rate.rate) * spreadMultiplier;
    const toAmount = Math.floor(fromAmount * effectiveRate);

    return {
      fromAmount,
      toAmount,
      fromCurrency,
      toCurrency,
      rate: Number(rate.rate),
      spread: Number(rate.spread),
      effectiveRate,
      rateId: rate.id,
      expiresAt: rate.expiresAt,
    };
  }

  async refreshMockRates(): Promise<void> {
    this.logger.log('Refreshing mock exchange rates');
    for (const [pair, rate] of Object.entries(this.MOCK_RATES)) {
      const [from, to] = pair.split('/');
      await this.upsertMockRate(from, to, rate);
    }
  }

  private async upsertMockRate(
    fromCurrency: string,
    toCurrency: string,
    overrideRate?: number,
  ): Promise<ExchangeRate> {
    const key = `${fromCurrency}/${toCurrency}`;
    const baseRate = overrideRate ?? this.MOCK_RATES[key];

    if (!baseRate) {
      throw new NotFoundException(
        `Exchange rate not available for ${fromCurrency}/${toCurrency}`,
      );
    }

    // Add ±0.5% random jitter to simulate live market
    const jitter = 1 + (Math.random() - 0.5) * 0.01;
    const rate = baseRate * jitter;

    const entity = this.rateRepo.create({
      fromCurrency,
      toCurrency,
      rate,
      spread: 0.02,
      source: 'mock',
      validAt: new Date(),
      expiresAt: new Date(Date.now() + 300_000), // 5 min expiry
    });

    const saved = await this.rateRepo.save(entity);
    await this.cache.set(`rate:${fromCurrency}:${toCurrency}`, saved, 60_000);
    return saved;
  }

  async getAllCurrentRates(): Promise<ExchangeRate[]> {
    return this.rateRepo.find({
      where: { expiresAt: MoreThan(new Date()) },
      order: { fromCurrency: 'ASC', toCurrency: 'ASC' },
    });
  }
}