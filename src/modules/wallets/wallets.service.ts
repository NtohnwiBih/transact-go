import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import { Wallet, WalletStatus, Currency } from './entities/wallet.entity';
import { LedgerEntry, EntryType, EntryCategory } from './entities/ledger-entry.entity';

export interface DebitParams {
  walletId: string;
  userId: string; // ownership verification
  amount: number;
  category: EntryCategory;
  narration: string;
  transferId?: string;
  providerReference?: string;
  metadata?: Record<string, any>;
}

export interface CreditParams {
  walletId: string;
  amount: number;
  category: EntryCategory;
  narration: string;
  transferId?: string;
  providerReference?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    @InjectRepository(Wallet)
    private walletRepo: Repository<Wallet>,
    @InjectRepository(LedgerEntry)
    private ledgerRepo: Repository<LedgerEntry>,
    private dataSource: DataSource,
  ) {}

  async createWallet(userId: string, currency: Currency): Promise<Wallet> {
    const existing = await this.walletRepo.findOne({ where: { userId, currency } });
    if (existing) {
      throw new BadRequestException(`You already have a ${currency} wallet`);
    }

    const wallet = this.walletRepo.create({
      userId,
      currency,
      balance: 0,
      heldBalance: 0,
      status: WalletStatus.ACTIVE,
    });

    const saved = await this.walletRepo.save(wallet);
    this.logger.log(`Wallet created: ${saved.id} (${currency}) for user ${userId}`);
    return saved;
  }

  async getWallet(walletId: string, userId: string): Promise<Wallet> {
    const wallet = await this.walletRepo.findOne({ where: { id: walletId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.userId !== userId) throw new ForbiddenException('Access denied');
    return wallet;
  }

  async getUserWallets(userId: string): Promise<Wallet[]> {
    return this.walletRepo.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
  }

  async debit(params: DebitParams, queryRunner: QueryRunner): Promise<LedgerEntry> {
    const { walletId, userId, amount } = params;

    if (amount <= 0) throw new BadRequestException('Debit amount must be positive');


    const wallet = await queryRunner.manager.findOne(Wallet, {
      where: { id: walletId },
      lock: { mode: 'pessimistic_write' }, 
    });

    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.userId !== userId) throw new ForbiddenException('Access denied');
    if (wallet.status !== WalletStatus.ACTIVE) {
      throw new BadRequestException(`Wallet is ${wallet.status} and cannot be debited`);
    }

    const available = wallet.balance - wallet.heldBalance;
    if (available < amount) {
      throw new BadRequestException(
        `Insufficient funds. Available: ${available}, Required: ${amount}`,
      );
    }

    const newBalance = wallet.balance - amount;

    // Update wallet balance
    await queryRunner.manager.update(Wallet, walletId, { balance: newBalance });

    // Create immutable ledger entry
    const entry = queryRunner.manager.create(LedgerEntry, {
      walletId,
      type: EntryType.DEBIT,
      category: params.category,
      amount,
      balanceAfter: newBalance,
      transferId: params.transferId,
      providerReference: params.providerReference,
      narration: params.narration,
      metadata: params.metadata,
    });

    const saved = await queryRunner.manager.save(LedgerEntry, entry);
    this.logger.debug(`Debited ${amount} from wallet ${walletId}. New balance: ${newBalance}`);
    return saved;
  }

  /**
   * Credit a wallet within an existing database transaction.
   */
  async credit(params: CreditParams, queryRunner: QueryRunner): Promise<LedgerEntry> {
    const { walletId, amount } = params;

    if (amount <= 0) throw new BadRequestException('Credit amount must be positive');

    const wallet = await queryRunner.manager.findOne(Wallet, {
      where: { id: walletId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.status === WalletStatus.CLOSED) {
      throw new BadRequestException('Cannot credit a closed wallet');
    }

    const newBalance = wallet.balance + amount;
    await queryRunner.manager.update(Wallet, walletId, { balance: newBalance });

    const entry = queryRunner.manager.create(LedgerEntry, {
      walletId,
      type: EntryType.CREDIT,
      category: params.category,
      amount,
      balanceAfter: newBalance,
      transferId: params.transferId,
      providerReference: params.providerReference,
      narration: params.narration,
      metadata: params.metadata,
    });

    const saved = await queryRunner.manager.save(LedgerEntry, entry);
    this.logger.debug(`Credited ${amount} to wallet ${walletId}. New balance: ${newBalance}`);
    return saved;
  }

  /**
   * Get transaction history for a wallet with pagination.
   */
  async getLedger(
    walletId: string,
    userId: string,
    options: { page?: number; limit?: number; category?: EntryCategory },
  ): Promise<{ entries: LedgerEntry[]; total: number; page: number; pages: number }> {
    // Verify ownership
    await this.getWallet(walletId, userId);

    const page = options.page || 1;
    const limit = Math.min(options.limit || 20, 100); // max 100 per page
    const skip = (page - 1) * limit;

    const where: any = { walletId };
    if (options.category) where.category = options.category;

    const [entries, total] = await this.ledgerRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' }, // most recent first
      skip,
      take: limit,
    });

    return {
      entries,
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  async reconcileBalance(walletId: string): Promise<{
    walletBalance: number;
    calculatedBalance: number;
    isConsistent: boolean;
  }> {
    const wallet = await this.walletRepo.findOneOrFail({ where: { id: walletId } });

    const result = await this.ledgerRepo
      .createQueryBuilder('le')
      .select(
        `SUM(CASE WHEN le.type = 'credit' THEN le.amount ELSE -le.amount END)`,
        'calculatedBalance',
      )
      .where('le.walletId = :walletId', { walletId })
      .getRawOne();

    const calculatedBalance = parseInt(result.calculatedBalance || '0', 10);
    const isConsistent = wallet.balance === calculatedBalance;

    if (!isConsistent) {
      this.logger.error(
        `Balance mismatch for wallet ${walletId}: ` +
        `stored=${wallet.balance}, calculated=${calculatedBalance}`,
      );
    }

    return { walletBalance: wallet.balance, calculatedBalance, isConsistent };
  }
}