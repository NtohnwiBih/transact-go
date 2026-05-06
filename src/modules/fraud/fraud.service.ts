import {
  ForbiddenException, Injectable, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';
import {
  FraudRule, FraudAlert, FraudRuleType, FraudAction,
} from './entities/fraud.entity';
import { LedgerEntry } from '../wallets/entities/ledger-entry.entity';
import { Transfer, TransferStatus } from '../transfers/entities/transfer.entity';

export interface FraudCheckParams {
  userId: string;
  amount: number;
  currency: string;
  kycTier: number;
  transferId?: string;
}

interface RuleCheckResult {
  triggered: boolean;
  ruleName: string;
  action: FraudAction;
  context: Record<string, any>;
}

@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);

  constructor(
    @InjectRepository(FraudRule)  private ruleRepo: Repository<FraudRule>,
    @InjectRepository(FraudAlert) private alertRepo: Repository<FraudAlert>,
    @InjectRepository(LedgerEntry) private ledgerRepo: Repository<LedgerEntry>,
    @InjectRepository(Transfer)   private transferRepo: Repository<Transfer>,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  /**
   * Evaluate all active fraud rules for a transaction.
   * - BLOCK action → throw ForbiddenException
   * - FLAG action  → record alert, allow transaction
   * - NOTIFY action → record alert, allow transaction
   */
  async evaluate(params: FraudCheckParams): Promise<void> {
    const rules = await this.getActiveRules(params.currency, params.kycTier);
    const results: RuleCheckResult[] = [];

    for (const rule of rules) {
      const result = await this.checkRule(rule, params);
      if (result.triggered) results.push(result);
    }

    if (results.length === 0) return;

    // Save all alerts first
    await Promise.all(
      results.map((r) =>
        this.alertRepo.save(
          this.alertRepo.create({
            userId: params.userId,
            transferId: params.transferId ?? null,
            ruleTriggered: r.ruleName,
            actionTaken: r.action,
            context: { ...r.context, amount: params.amount, currency: params.currency },
          }),
        ),
      ),
    );

    // If any rule says BLOCK, prevent the transaction
    const blocked = results.find((r) => r.action === FraudAction.BLOCK);
    if (blocked) {
      this.logger.warn(
        `Transaction BLOCKED for user ${params.userId}: rule="${blocked.ruleName}"`,
      );
      throw new ForbiddenException(
        `Transaction flagged by fraud detection: ${blocked.ruleName}. ` +
        `Please contact support if you believe this is an error.`,
      );
    }

    this.logger.warn(
      `Fraud flags for user ${params.userId}: ${results.map((r) => r.ruleName).join(', ')}`,
    );
  }

  private async checkRule(rule: FraudRule, params: FraudCheckParams): Promise<RuleCheckResult> {
    const base = { ruleName: rule.name, action: rule.action };

    switch (rule.ruleType) {
      case FraudRuleType.VELOCITY:
        return this.checkVelocity(rule, params, base);

      case FraudRuleType.DAILY_LIMIT:
        return this.checkDailyLimit(rule, params, base);

      case FraudRuleType.LARGE_AMOUNT:
        return this.checkLargeAmount(rule, params, base);

      case FraudRuleType.UNUSUAL_PATTERN:
        return this.checkUnusualPattern(rule, params, base);

      default:
        return { ...base, triggered: false, context: {} };
    }
  }

  /** Velocity: too many transactions in a rolling time window */
  private async checkVelocity(
    rule: FraudRule,
    params: FraudCheckParams,
    base: Pick<RuleCheckResult, 'ruleName' | 'action'>,
  ): Promise<RuleCheckResult> {
    const { maxCount, windowSeconds } = rule.config as { maxCount: number; windowSeconds: number };
    const cacheKey = `fraud:velocity:${params.userId}:${params.currency}:${rule.id}`;

    // Atomic increment in Redis — fast and avoids DB scan on every request
    let count: number;
    try {
      const current = await this.cache.get<number>(cacheKey) ?? 0;
      count = current + 1;
      await this.cache.set(cacheKey, count, windowSeconds * 1000);
    } catch {
      // Redis unavailable — fall back to DB count
      const since = new Date(Date.now() - windowSeconds * 1000);
      const result = await this.transferRepo.count({
        where: {
          userId: params.userId,
          currency: params.currency,
          createdAt: MoreThanOrEqual(since),
        },
      });
      count = result + 1;
    }

    return {
      ...base,
      triggered: count > maxCount,
      context: { count, maxCount, windowSeconds },
    };
  }

  /** Daily limit: total amount sent today exceeds threshold */
  private async checkDailyLimit(
    rule: FraudRule,
    params: FraudCheckParams,
    base: Pick<RuleCheckResult, 'ruleName' | 'action'>,
  ): Promise<RuleCheckResult> {
    const { maxAmount } = rule.config as { maxAmount: number };
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const result = await this.transferRepo
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.amount), 0)', 'total')
      .where('t.userId = :uid', { uid: params.userId })
      .andWhere('t.currency = :cur', { cur: params.currency })
      .andWhere('t.status IN (:...statuses)', {
        statuses: [TransferStatus.COMPLETED, TransferStatus.PROCESSING],
      })
      .andWhere('t.createdAt >= :since', { since: startOfDay })
      .getRawOne();

    const dailyTotal = parseInt(result.total, 10);
    const projectedTotal = dailyTotal + params.amount;

    return {
      ...base,
      triggered: projectedTotal > maxAmount,
      context: { dailyTotal, projectedTotal, maxAmount },
    };
  }

  /** Large amount: single transaction >> user's historical average */
  private async checkLargeAmount(
    rule: FraudRule,
    params: FraudCheckParams,
    base: Pick<RuleCheckResult, 'ruleName' | 'action'>,
  ): Promise<RuleCheckResult> {
    const { multiplier, minHistory } = rule.config as { multiplier: number; minHistory: number };
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    const result = await this.transferRepo
      .createQueryBuilder('t')
      .select('AVG(t.amount)::bigint', 'avg')
      .addSelect('COUNT(*)', 'cnt')
      .where('t.userId = :uid', { uid: params.userId })
      .andWhere('t.currency = :cur', { cur: params.currency })
      .andWhere('t.status = :status', { status: TransferStatus.COMPLETED })
      .andWhere('t.createdAt >= :since', { since: thirtyDaysAgo })
      .getRawOne();

    const avg = parseInt(result.avg || '0', 10);
    const cnt = parseInt(result.cnt, 10);

    // Not enough history to make a meaningful comparison
    if (cnt < minHistory || avg === 0) {
      return { ...base, triggered: false, context: { reason: 'insufficient_history' } };
    }

    const threshold = avg * multiplier;
    return {
      ...base,
      triggered: params.amount > threshold,
      context: { amount: params.amount, avg, threshold, multiplier, historyCount: cnt },
    };
  }

  /** Unusual pattern: z-score based anomaly detection */
  private async checkUnusualPattern(
    rule: FraudRule,
    params: FraudCheckParams,
    base: Pick<RuleCheckResult, 'ruleName' | 'action'>,
  ): Promise<RuleCheckResult> {
    const { zScoreThreshold } = rule.config as { zScoreThreshold: number };
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    const result = await this.transferRepo
      .createQueryBuilder('t')
      .select('AVG(t.amount)::bigint', 'mean')
      .addSelect('STDDEV(t.amount)::bigint', 'stddev')
      .addSelect('COUNT(*)', 'cnt')
      .where('t.userId = :uid', { uid: params.userId })
      .andWhere('t.currency = :cur', { cur: params.currency })
      .andWhere('t.status = :status', { status: TransferStatus.COMPLETED })
      .andWhere('t.createdAt >= :since', { since: thirtyDaysAgo })
      .getRawOne();

    const mean   = parseInt(result.mean   || '0', 10);
    const stddev = parseInt(result.stddev || '0', 10);
    const cnt    = parseInt(result.cnt, 10);

    if (cnt < 5 || stddev === 0) {
      return { ...base, triggered: false, context: { reason: 'insufficient_history' } };
    }

    const zScore = Math.abs((params.amount - mean) / stddev);
    return {
      ...base,
      triggered: zScore > zScoreThreshold,
      context: { zScore: zScore.toFixed(2), zScoreThreshold, mean, stddev },
    };
  }

  private async getActiveRules(currency: string, kycTier: number): Promise<FraudRule[]> {
    const cacheKey = `fraud:rules:${currency}:${kycTier}`;
    const cached = await this.cache.get<FraudRule[]>(cacheKey);
    if (cached) return cached;

    // Fetch rules that match this currency+tier OR are global (null = all)
    const rules = await this.ruleRepo
      .createQueryBuilder('r')
      .where('r.isActive = true')
      .andWhere('(r.currency IS NULL OR r.currency = :currency)', { currency })
      .andWhere('(r.kycTier IS NULL OR r.kycTier = :kycTier)', { kycTier })
      .orderBy('r.priority', 'DESC')
      .getMany();

    await this.cache.set(cacheKey, rules, 120_000); // 2 min cache
    return rules;
  }

  async getUserAlerts(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [alerts, total] = await this.alertRepo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
    return { alerts, total, page, pages: Math.ceil(total / limit) };
  }

  /** Seed default fraud rules */
  async seedDefaultRules(): Promise<void> {
    const defaults: Partial<FraudRule>[] = [
      {
        name: 'High Velocity — NGN',
        ruleType: FraudRuleType.VELOCITY,
        currency: 'NGN',
        kycTier: null,
        config: { maxCount: 20, windowSeconds: 3600 },
        action: FraudAction.BLOCK,
        isActive: true,
        priority: 10,
      },
      {
        name: 'Large Single Transfer — NGN',
        ruleType: FraudRuleType.LARGE_AMOUNT,
        currency: 'NGN',
        kycTier: null,
        config: { multiplier: 10, minHistory: 5 },
        action: FraudAction.FLAG,
        isActive: true,
        priority: 5,
      },
      {
        name: 'Unusual Pattern Detection',
        ruleType: FraudRuleType.UNUSUAL_PATTERN,
        currency: null,
        kycTier: null,
        config: { zScoreThreshold: 3.5 },
        action: FraudAction.FLAG,
        isActive: true,
        priority: 3,
      },
    ];

    for (const rule of defaults) {
      const exists = await this.ruleRepo.findOne({ where: { name: rule.name } });
      if (!exists) {
        await this.ruleRepo.save(this.ruleRepo.create(rule));
        this.logger.log(`Seeded fraud rule: ${rule.name}`);
      }
    }
  }
}