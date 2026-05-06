import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cache } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { FeeRule, FeeType } from './entities/fee-rule.entity';

export interface FeeCalculationParams {
  amount: number;        
  currency: string;
  transactionType: string;
}

export interface FeeBreakdown {
  baseFee: number;        
  tax: number;            
  totalFee: number;       
  currency: string;
  ruleId: string | null;
  ruleName: string | null;
  lineItems: Array<{ label: string; amount: number }>;
}

@Injectable()
export class FeesService {
  private readonly logger = new Logger(FeesService.name);

  constructor(
    @InjectRepository(FeeRule)
    private feeRuleRepo: Repository<FeeRule>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

  async calculate(params: FeeCalculationParams): Promise<FeeBreakdown> {
    const rule = await this.getActiveRule(params.currency, params.transactionType);

    if (!rule) {
      this.logger.debug(
        `No fee rule found for ${params.currency}/${params.transactionType} — no fee applied`,
      );
      return this.buildZeroFee(params.currency);
    }

    // Check if the transfer amount is within the rule's applicable range
    if (params.amount < rule.minTransferAmount) {
      return this.buildZeroFee(params.currency);
    }
    if (rule.maxTransferAmount && params.amount > rule.maxTransferAmount) {
      return this.buildZeroFee(params.currency);
    }

    let baseFee = this.computeBaseFee(rule, params.amount);

    // Apply floor (minimum fee)
    if (rule.floor !== null && baseFee < rule.floor) {
      baseFee = rule.floor;
    }

    // Apply cap (maximum fee)
    if (rule.cap !== null && baseFee > rule.cap) {
      baseFee = rule.cap;
    }

    // Tax on the fee itself (e.g. 7.5% VAT)
    const tax = rule.taxRate > 0 ? Math.round(baseFee * rule.taxRate) : 0;
    const totalFee = baseFee + tax;

    const lineItems = [
      { label: rule.name, amount: baseFee },
      ...(tax > 0 ? [{ label: `VAT (${(Number(rule.taxRate) * 100).toFixed(1)}%)`, amount: tax }] : []),
    ];

    this.logger.debug(
      `Fee calculated: ${params.currency} ${params.transactionType} ` +
      `amount=${params.amount} → fee=${totalFee} (base=${baseFee}, tax=${tax})`,
    );

    return {
      baseFee,
      tax,
      totalFee,
      currency: params.currency,
      ruleId: rule.id,
      ruleName: rule.name,
      lineItems,
    };
  }

  private computeBaseFee(rule: FeeRule, amount: number): number {
    switch (rule.feeType) {
      case FeeType.FLAT:
        return rule.flatAmount;

      case FeeType.PERCENTAGE:
        // Math.round prevents floating point issues
        return Math.round(amount * Number(rule.percentage));

      case FeeType.TIERED: {
        if (!rule.tierConfig || rule.tierConfig.length === 0) {
          return rule.flatAmount; // fallback to flat if no tiers configured
        }

        const matchingTier = rule.tierConfig.find(
          (tier) =>
            amount >= tier.minAmount &&
            (tier.maxAmount === null || amount <= tier.maxAmount),
        );

        if (!matchingTier) {
          this.logger.warn(
            `No matching tier for amount=${amount} in rule ${rule.ruleCode}. Using flat fallback.`,
          );
          return rule.flatAmount;
        }

        return matchingTier.flatFee;
      }

      default:
        return 0;
    }
  }

  private buildZeroFee(currency: string): FeeBreakdown {
    return {
      baseFee: 0,
      tax: 0,
      totalFee: 0,
      currency,
      ruleId: null,
      ruleName: null,
      lineItems: [],
    };
  }

  private async getActiveRule(currency: string, transactionType: string): Promise<FeeRule | null> {
    const cacheKey = `fee_rule:${currency}:${transactionType}`;
    const cached = await this.cacheManager.get<FeeRule>(cacheKey);
    if (cached) return cached;

    const rule = await this.feeRuleRepo.findOne({
      where: { currency, transactionType, isActive: true },
      order: { priority: 'DESC' }, // highest priority rule wins if multiple match
    });

    if (rule) {
      await this.cacheManager.set(cacheKey, rule, 300_000); // 5 minutes
    }

    return rule || null;
  }

  /**
   * Call this when a fee rule is updated via the admin panel.
   * Clears the cache so the new rule takes effect immediately.
   */
  async invalidateFeeCache(currency?: string, transactionType?: string): Promise<void> {
    if (currency && transactionType) {
      await this.cacheManager.del(`fee_rule:${currency}:${transactionType}`);
    } else {
      // In production: use cache.reset() or scan Redis keys with pattern
      this.logger.warn('Full fee cache invalidation requested — implement key pattern scan for Redis');
    }
  }

  /**
   * Seed default Nigerian fintech fee rules.
   * Call this in a migration or startup seed script.
   */
  async seedDefaultRules(): Promise<void> {
    const rules: Partial<FeeRule>[] = [
      // Nigerian NIP Transfer Fee (aligned with CBN guidelines)
      {
        name: 'NGN Internal Transfer Fee (NIP)',
        ruleCode: 'NGN_INTERNAL_TRANSFER',
        currency: 'NGN',
        transactionType: 'internal',
        feeType: FeeType.TIERED,
        flatAmount: 0,
        taxRate: 0.075, // 7.5% VAT
        tierConfig: [
          { minAmount: 0,      maxAmount: 500000,   flatFee: 1000  }, // ₦0–₦5,000 → ₦10 fee
          { minAmount: 500001, maxAmount: 5000000,  flatFee: 2500  }, // ₦5,001–₦50,000 → ₦25 fee
          { minAmount: 5000001, maxAmount: null,    flatFee: 5000  }, // ₦50,001+ → ₦50 fee
        ],
        cap: 5000, // max ₦50 fee
        priority: 10,
      },
      // USD Withdrawal Fee
      {
        name: 'USD External Withdrawal Fee',
        ruleCode: 'USD_WITHDRAWAL',
        currency: 'USD',
        transactionType: 'withdrawal',
        feeType: FeeType.PERCENTAGE,
        percentage: 0.015, 
        floor: 100,       
        cap: 5000,         
        taxRate: 0,
        priority: 10,
      },
      // NGN Deposit Fee (free)
      {
        name: 'NGN Deposit (Free)',
        ruleCode: 'NGN_DEPOSIT',
        currency: 'NGN',
        transactionType: 'deposit',
        feeType: FeeType.FLAT,
        flatAmount: 0,
        taxRate: 0,
        priority: 10,
      },
    ];

    for (const ruleData of rules) {
      const existing = await this.feeRuleRepo.findOne({ where: { ruleCode: ruleData.ruleCode } });
      if (!existing) {
        await this.feeRuleRepo.save(this.feeRuleRepo.create(ruleData));
        this.logger.log(`Seeded fee rule: ${ruleData.ruleCode}`);
      }
    }
  }
}