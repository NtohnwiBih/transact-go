import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { Transfer, TransferStatus, TransferType } from '../transfers/entities/transfer.entity';
import { LedgerEntry } from '../wallets/entities/ledger-entry.entity';
import { Wallet } from '../wallets/entities/wallet.entity';

export interface AccountStatement {
  walletId: string;
  currency: string;
  openingBalance: number;
  closingBalance: number;
  totalCredits: number;
  totalDebits: number;
  transactionCount: number;
  entries: LedgerEntry[];
  period: { from: Date; to: Date };
  generatedAt: Date;
}

export interface TransactionSummary {
  period: { from: Date; to: Date };
  totalTransfers: number;
  totalVolume: number;
  totalFees: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  byCurrency: Record<string, { count: number; volume: number; fees: number }>;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectRepository(Transfer)    private transferRepo: Repository<Transfer>,
    @InjectRepository(LedgerEntry) private ledgerRepo: Repository<LedgerEntry>,
    @InjectRepository(Wallet)      private walletRepo: Repository<Wallet>,
  ) {}

  /**
   * Generate a wallet account statement for a date range.
   * Returns all ledger entries with running balance.
   */
  async generateStatement(
    walletId: string,
    userId: string,
    from: Date,
    to: Date,
  ): Promise<AccountStatement> {
    const wallet = await this.walletRepo.findOneOrFail({ where: { id: walletId, userId } });

    // Get the balance just before the period started
    const openingEntry = await this.ledgerRepo.findOne({
      where: { walletId, createdAt: LessThanOrEqual(from) },
      order: { createdAt: 'DESC' },
    });
    const openingBalance = openingEntry?.balanceAfter ?? 0;

    // Get all entries in the period
    const entries = await this.ledgerRepo.find({
      where: { walletId, createdAt: Between(from, to) },
      order: { createdAt: 'ASC' },
    });

    const closingBalance = entries.length > 0
      ? entries[entries.length - 1].balanceAfter
      : openingBalance;

    const totalCredits = entries
      .filter((e) => e.type === 'credit')
      .reduce((sum, e) => sum + Number(e.amount), 0);

    const totalDebits = entries
      .filter((e) => e.type === 'debit')
      .reduce((sum, e) => sum + Number(e.amount), 0);

    return {
      walletId,
      currency: wallet.currency,
      openingBalance,
      closingBalance,
      totalCredits,
      totalDebits,
      transactionCount: entries.length,
      entries,
      period: { from, to },
      generatedAt: new Date(),
    };
  }

  /**
   * Transaction summary analytics — for user dashboard.
   */
  async getUserSummary(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<TransactionSummary> {
    const transfers = await this.transferRepo.find({
      where: { userId, createdAt: Between(from, to) },
    });

    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byCurrency: Record<string, { count: number; volume: number; fees: number }> = {};

    let totalVolume = 0;
    let totalFees = 0;

    for (const t of transfers) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      byType[t.type]     = (byType[t.type] ?? 0) + 1;

      if (!byCurrency[t.currency]) {
        byCurrency[t.currency] = { count: 0, volume: 0, fees: 0 };
      }
      byCurrency[t.currency].count++;
      byCurrency[t.currency].volume += Number(t.amount);
      byCurrency[t.currency].fees   += Number(t.fee);

      totalVolume += Number(t.amount);
      totalFees   += Number(t.fee);
    }

    return {
      period: { from, to },
      totalTransfers: transfers.length,
      totalVolume,
      totalFees,
      byStatus,
      byType,
      byCurrency,
    };
  }

  /**
   * Platform-wide analytics — for admin dashboard.
   */
  async getPlatformSummary(from: Date, to: Date): Promise<any> {
    const result = await this.transferRepo
      .createQueryBuilder('t')
      .select('t.currency', 'currency')
      .addSelect('t.type', 'type')
      .addSelect('t.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(t.amount)', 'volume')
      .addSelect('SUM(t.fee)', 'fees')
      .where('t.createdAt BETWEEN :from AND :to', { from, to })
      .groupBy('t.currency, t.type, t.status')
      .getRawMany();

    return {
      period: { from, to },
      breakdown: result,
      generatedAt: new Date(),
    };
  }
}