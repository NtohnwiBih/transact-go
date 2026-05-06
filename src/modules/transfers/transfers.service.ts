import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Transfer, TransferStatus, TransferType } from './entities/transfer.entity';
import { FeesService } from '../fees/fees.service';
import { EntryCategory } from '../wallets/entities/ledger-entry.entity';
import { User, KycTier } from '../users/entities/user.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import { WalletsService } from '../wallets/wallets.service';

export class InternalTransferDto {
  sourceWalletId: string;
  destinationWalletId: string;
  amount: number; // in smallest unit
  currency: string;
  narration?: string;
  reference?: string;
}

// KYC tier daily transfer limits (in kobo for NGN)
const DAILY_LIMITS: Record<KycTier, number> = {
  [KycTier.UNVERIFIED]: 0,
  [KycTier.TIER_1]: 5_000_000,   // ₦50,000
  [KycTier.TIER_2]: 50_000_000,  // ₦500,000
  [KycTier.TIER_3]: Infinity,
};

@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);

  constructor(
    @InjectRepository(Transfer)
    private transferRepo: Repository<Transfer>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Wallet)
    private walletRepo: Repository<Wallet>,
    private walletsService: WalletsService,
    private feesService: FeesService,
    private dataSource: DataSource,
  ) {}


  async internalTransfer(userId: string, dto: InternalTransferDto): Promise<Transfer> {
    // Pre-transaction validation (read-only, no lock needed)
    const [sourceWallet, destWallet, user] = await Promise.all([
      this.walletRepo.findOne({ where: { id: dto.sourceWalletId } }),
      this.walletRepo.findOne({ where: { id: dto.destinationWalletId } }),
      this.userRepo.findOne({ where: { id: userId } }),
    ]);

    if (!sourceWallet) throw new NotFoundException('Source wallet not found');
    if (!destWallet) throw new NotFoundException('Destination wallet not found');
    if (!user) throw new NotFoundException('User not found');

    if (sourceWallet.userId !== userId) throw new ForbiddenException('Access denied to source wallet');
    if (sourceWallet.id === destWallet.id) throw new BadRequestException('Cannot transfer to the same wallet');
    if (sourceWallet.currency !== destWallet.currency) {
      throw new BadRequestException(
        'Cross-currency internal transfers not supported. Use the exchange endpoint.',
      );
    }

    if (dto.amount <= 0) throw new BadRequestException('Transfer amount must be positive');

    // Check KYC tier
    if (user.kycTier === KycTier.UNVERIFIED) {
      throw new ForbiddenException('Please complete identity verification (KYC) before making transfers');
    }

    // Check daily limit
    await this.assertWithinDailyLimit(userId, dto.amount, dto.currency, user.kycTier);

    // Calculate fees (from DB rules, not hardcoded)
    const feeBreakdown = await this.feesService.calculate({
      amount: dto.amount,
      currency: dto.currency,
      transactionType: 'internal',
    });

    const totalDebit = dto.amount + feeBreakdown.totalFee;

    // ── BEGIN TRANSACTION ────────────────────────────────────────────────────
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Create the transfer record first (so we have an ID for ledger entries)
      const transfer = queryRunner.manager.create(Transfer, {
        userId,
        type: TransferType.INTERNAL,
        status: TransferStatus.PROCESSING,
        currency: dto.currency,
        amount: dto.amount,
        fee: feeBreakdown.totalFee,
        tax: feeBreakdown.tax,
        feeBreakdown: feeBreakdown as any,
        sourceWalletId: dto.sourceWalletId,
        destinationWalletId: dto.destinationWalletId,
        narration: dto.narration,
        reference: dto.reference,
      });
      const savedTransfer = await queryRunner.manager.save(Transfer, transfer);

      // Debit the source wallet: amount + fee
      await this.walletsService.debit(
        {
          walletId: dto.sourceWalletId,
          userId,
          amount: totalDebit,
          category: EntryCategory.INTERNAL_DEBIT,
          narration: dto.narration || `Transfer to wallet ${dto.destinationWalletId}`,
          transferId: savedTransfer.id,
          metadata: { feeBreakdown },
        },
        queryRunner,
      );

      // Credit the destination wallet: amount only (fees stay in platform)
      await this.walletsService.credit(
        {
          walletId: dto.destinationWalletId,
          amount: dto.amount,
          category: EntryCategory.INTERNAL_CREDIT,
          narration: dto.narration || `Transfer from wallet ${dto.sourceWalletId}`,
          transferId: savedTransfer.id,
        },
        queryRunner,
      );

      // Mark transfer as completed
      await queryRunner.manager.update(Transfer, savedTransfer.id, {
        status: TransferStatus.COMPLETED,
        completedAt: new Date(),
      });

      await queryRunner.commitTransaction();

      this.logger.log(
        `Internal transfer completed: ${savedTransfer.id} ` +
        `amount=${dto.amount} fee=${feeBreakdown.totalFee} currency=${dto.currency}`,
      );

      return { ...savedTransfer, status: TransferStatus.COMPLETED, completedAt: new Date() };

    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Internal transfer failed: ${err.message}`, err.stack);
      throw err;
    } finally {
      await queryRunner.release();
    }
    // ── END TRANSACTION ──────────────────────────────────────────────────────
  }

  async getTransferHistory(
    userId: string,
    options: { page?: number; limit?: number; status?: TransferStatus; type?: TransferType },
  ): Promise<{ transfers: Transfer[]; total: number; page: number; pages: number }> {
    const page = options.page || 1;
    const limit = Math.min(options.limit || 20, 100);
    const skip = (page - 1) * limit;

    const where: any = { userId };
    if (options.status) where.status = options.status;
    if (options.type) where.type = options.type;

    const [transfers, total] = await this.transferRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return { transfers, total, page, pages: Math.ceil(total / limit) };
  }

  async getTransferById(id: string, userId: string): Promise<Transfer> {
    const transfer = await this.transferRepo.findOne({ where: { id } });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.userId !== userId) throw new ForbiddenException('Access denied');
    return transfer;
  }

  /**
   * Verify that this user hasn't exceeded their KYC tier's daily limit.
   * Daily limit = sum of all completed/processing transfers in the last 24h.
   */
  async assertWithinDailyLimit(
    userId: string,
    amount: number,
    currency: string,
    kycTier: KycTier,
  ): Promise<void> {
    const limit = DAILY_LIMITS[kycTier];
    if (limit === Infinity) return; // Tier 3: no limit

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const result = await this.transferRepo
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.amount), 0)', 'dailyTotal')
      .where('t.userId = :userId', { userId })
      .andWhere('t.currency = :currency', { currency })
      .andWhere('t.status IN (:...statuses)', {
        statuses: [TransferStatus.COMPLETED, TransferStatus.PROCESSING],
      })
      .andWhere('t.createdAt >= :startOfDay', { startOfDay })
      .getRawOne();

    const dailyTotal = parseInt(result.dailyTotal, 10);

    if (dailyTotal + amount > limit) {
      throw new ForbiddenException(
        `Daily transfer limit exceeded for your KYC tier. ` +
        `Limit: ${limit}, Used: ${dailyTotal}, Requested: ${amount}. ` +
        `Please upgrade your KYC tier to increase your limit.`,
      );
    }
  }
}