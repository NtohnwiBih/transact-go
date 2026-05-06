import {
  Body, Controller, Get, Module, Param, ParseUUIDPipe,
  Patch, Post, Query, SetMetadata, UseGuards,
  CanActivate, ExecutionContext, Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus, KycTier } from '../users/entities/user.entity';
import { Wallet, WalletStatus } from '../wallets/entities/wallet.entity';
import { Transfer } from '../transfers/entities/transfer.entity';
import { FeeRule } from '../fees/entities/fee-rule.entity';
import { FraudRule, FraudAlert } from '../fraud/entities/fraud.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { KycSubmission } from '../kyc/entities/kyc-submission.entity';
import { ReportsService } from '../reports/reports.service';
import { FeesService } from '../fees/fees.service';
import { FraudService } from '../fraud/fraud.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReportsModule } from '../reports/reports.module';
import { FeesModule } from '../fees/fees.module';
import { FraudModule } from '../fraud/fraud.module';
import { AuditModule } from '../audit/audit.module';

// ─── Admin Guard ─────────────────────────────────────────────────────────────
export const ADMIN_KEY = 'isAdmin';
export const Admin = () => SetMetadata(ADMIN_KEY, true);

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const isAdmin = this.reflector.getAllAndOverride<boolean>(ADMIN_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (!isAdmin) return true;
    const user = ctx.switchToHttp().getRequest().user;
    return !!user;
  }
}

// ─── Admin Controller ─────────────────────────────────────────────────────────
@Controller('admin')
@Admin()
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    @InjectRepository(User)          private userRepo: Repository<User>,
    @InjectRepository(Wallet)        private walletRepo: Repository<Wallet>,
    @InjectRepository(Transfer)      private transferRepo: Repository<Transfer>,
    @InjectRepository(FeeRule)       private feeRuleRepo: Repository<FeeRule>,
    @InjectRepository(FraudRule)     private fraudRuleRepo: Repository<FraudRule>,
    @InjectRepository(FraudAlert)    private fraudAlertRepo: Repository<FraudAlert>,
    @InjectRepository(KycSubmission) private kycRepo: Repository<KycSubmission>,
    private reportsService: ReportsService,
    private feesService: FeesService,
    private fraudService: FraudService,
    private auditService: AuditService,
  ) {}

  // ── Users ─────────────────────────────────────────────────────────────────
  @Get('users')
  listUsers(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('status') status?: UserStatus,
  ) {
    return this.userRepo.findAndCount({
      where: status ? { status } : {},
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
      order: { createdAt: 'DESC' },
      select: ['id', 'email', 'firstName', 'lastName', 'status', 'kycTier', 'createdAt'],
    });
  }

  @Get('users/:id')
  getUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.userRepo.findOne({
      where: { id },
      select: ['id', 'email', 'firstName', 'lastName', 'status', 'kycTier',
               'failedLoginAttempts', 'lastLoginAt', 'createdAt', 'updatedAt'],
    });
  }

  @Patch('users/:id/suspend')
  async suspendUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @Body() body: { reason: string },
  ) {
    await this.userRepo.update(id, { status: UserStatus.SUSPENDED });
    this.auditService.log({
      action: AuditAction.ADMIN_ACTION,
      userId: id,
      actorId,
      metadata: { action: 'suspend', reason: body.reason },
    });
    return { success: true };
  }

  @Patch('users/:id/activate')
  async activateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
  ) {
    await this.userRepo.update(id, {
      status: UserStatus.ACTIVE,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    this.auditService.log({
      action: AuditAction.ADMIN_ACTION, userId: id, actorId,
      metadata: { action: 'activate' },
    });
    return { success: true };
  }

  @Patch('users/:id/kyc-tier')
  async overrideKycTier(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @Body() body: { tier: KycTier; reason: string },
  ) {
    await this.userRepo.update(id, { kycTier: body.tier });
    this.auditService.log({
      action: AuditAction.ADMIN_ACTION, userId: id, actorId,
      metadata: { action: 'override_kyc_tier', tier: body.tier, reason: body.reason },
    });
    return { success: true };
  }

  // ── Wallets ───────────────────────────────────────────────────────────────
  @Get('wallets/:userId')
  getUserWallets(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.walletRepo.find({ where: { userId }, order: { createdAt: 'ASC' } });
  }

  @Patch('wallets/:id/freeze')
  async freezeWallet(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @Body() body: { reason: string },
  ) {
    await this.walletRepo.update(id, { status: WalletStatus.FROZEN });
    this.auditService.log({
      action: AuditAction.WALLET_FREEZE,
      resourceType: 'wallet', resourceId: id, actorId,
      metadata: { reason: body.reason },
    });
    return { success: true };
  }

  // ── KYC Review ───────────────────────────────────────────────────────────
  @Get('kyc/pending')
  getPendingKyc() {
    return this.kycRepo.find({
      where: { status: 'pending' as any },
      order: { createdAt: 'ASC' },
    });
  }

  // ── Fee Rules ─────────────────────────────────────────────────────────────
  @Get('fee-rules')
  listFeeRules() {
    return this.feeRuleRepo.find({ order: { currency: 'ASC', transactionType: 'ASC' } });
  }

  @Post('fee-rules')
  async createFeeRule(@Body() dto: Partial<FeeRule>, @CurrentUser('id') actorId: string) {
    const rule = await this.feeRuleRepo.save(this.feeRuleRepo.create(dto));
    await this.feesService.invalidateFeeCache(dto.currency, dto.transactionType);
    this.auditService.log({
      action: AuditAction.FEE_RULE_UPDATE, actorId,
      resourceType: 'fee_rule', resourceId: rule.id,
      metadata: { action: 'create', rule: dto },
    });
    return rule;
  }

  @Patch('fee-rules/:id')
  async updateFeeRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<FeeRule>,
    @CurrentUser('id') actorId: string,
  ) {
    await this.feeRuleRepo.update(id, dto);
    await this.feesService.invalidateFeeCache(dto.currency, dto.transactionType);
    this.auditService.log({
      action: AuditAction.FEE_RULE_UPDATE, actorId,
      resourceType: 'fee_rule', resourceId: id,
      metadata: { action: 'update', changes: dto },
    });
    return this.feeRuleRepo.findOne({ where: { id } });
  }

  // ── Fraud Rules ───────────────────────────────────────────────────────────
  @Get('fraud-rules')
  listFraudRules() {
    return this.fraudRuleRepo.find({ order: { priority: 'DESC' } });
  }

  @Post('fraud-rules')
  createFraudRule(@Body() dto: Partial<FraudRule>) {
    return this.fraudRuleRepo.save(this.fraudRuleRepo.create(dto));
  }

  @Patch('fraud-rules/:id')
  updateFraudRule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: Partial<FraudRule>) {
    return this.fraudRuleRepo.update(id, dto);
  }

  @Get('fraud-alerts')
  listFraudAlerts(
    @Query('reviewed') reviewed?: string,
    @Query('page') page = '1',
  ) {
    return this.fraudAlertRepo.findAndCount({
      where: reviewed !== undefined ? { reviewed: reviewed === 'true' } : {},
      order: { createdAt: 'DESC' },
      skip: (parseInt(page) - 1) * 20,
      take: 20,
    });
  }

  @Patch('fraud-alerts/:id/review')
  async reviewFraudAlert(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @Body() body: { notes: string },
  ) {
    await this.fraudAlertRepo.update(id, {
      reviewed: true,
      reviewedBy: actorId,
      reviewNotes: body.notes,
    });
    return { success: true };
  }

  // ── Platform Reports ──────────────────────────────────────────────────────
  @Get('reports/platform')
  getPlatformReport(@Query('from') from: string, @Query('to') to: string) {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400_000);
    const toDate   = to   ? new Date(to)   : new Date();
    return this.reportsService.getPlatformSummary(fromDate, toDate);
  }

  // ── Audit Logs ────────────────────────────────────────────────────────────
  @Get('audit-logs')
  getAuditLogs(
    @Query('userId') userId?: string,
    @Query('action') action?: AuditAction,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = '1',
  ) {
    return this.auditService.getLogs({
      userId,
      action,
      from: from ? new Date(from) : undefined,
      to:   to   ? new Date(to)   : undefined,
      page: parseInt(page),
    });
  }
}

// ─── Admin Module ─────────────────────────────────────────────────────────────
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User, Wallet, Transfer, FeeRule, FraudRule, FraudAlert, KycSubmission, AuditLog,
    ]),
    ReportsModule,
    FeesModule,
    FraudModule,
    AuditModule,
  ],
  controllers: [AdminController],
  providers: [AdminGuard],
})
export class AdminModule {}