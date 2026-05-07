import {
  Body, Controller, Get, Module, Param, ParseUUIDPipe,
  Patch, Post, Query, SetMetadata, UseGuards,
  CanActivate, ExecutionContext, Injectable,
  DefaultValuePipe, ParseIntPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ApiBearerAuth, ApiOperation, ApiQuery, ApiTags,
} from '@nestjs/swagger';
import { User, UserStatus, KycTier } from '../users/entities/user.entity';
import { Wallet, WalletStatus } from '../wallets/entities/wallet.entity';
import { Transfer } from '../transfers/entities/transfer.entity';
import { FeeRule } from '../fees/entities/fee-rule.entity';
import { FraudRule, FraudAlert } from '../fraud/entities/fraud.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditAction } from '../audit/entities/audit-log.entity';
import { KycSubmission } from '../kyc/entities/kyc-submission.entity';
import { ReportsService } from '../reports/reports.service';
import { ReportsModule } from '../reports/reports.module';
import { FeesService } from '../fees/fees.service';
import { FeesModule } from '../fees/fees.module';
import { FraudService } from '../fraud/fraud.service';
import { FraudModule } from '../fraud/fraud.module';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  SuspendUserDto, OverrideKycTierDto, FreezeWalletDto,
  CreateFeeRuleDto, UpdateFeeRuleDto,
  CreateFraudRuleDto, UpdateFraudRuleDto,
  ReviewFraudAlertDto,
} from './dto/admin.dto';

// ─── Admin Guard ──────────────────────────────────────────────────────────────
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
    return !!user; // TODO: check user.role === 'admin'
  }
}

// ─── Admin Controller ─────────────────────────────────────────────────────────
@ApiTags('Admin')
@ApiBearerAuth('access-token')
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

  // ── Users ──────────────────────────────────────────────────────────────────

  @Get('users')
  @ApiOperation({ summary: 'List all users (paginated)', description: 'Optionally filter by status.' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'status', required: false, enum: UserStatus })
  listUsers(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status') status?: UserStatus,
  ) {
    return this.userRepo.findAndCount({
      where: status ? { status } : {},
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
      select: ['id', 'email', 'firstName', 'lastName', 'status', 'kycTier', 'createdAt'],
    });
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Get full user detail by ID' })
  getUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.userRepo.findOne({
      where: { id },
      select: ['id', 'email', 'firstName', 'lastName', 'status', 'kycTier',
               'failedLoginAttempts', 'lastLoginAt', 'createdAt', 'updatedAt'],
    });
  }

  @Patch('users/:id/suspend')
  @ApiOperation({
    summary: 'Suspend a user account',
    description: 'Blocks login and all transactions. Reason is written to the audit log.',
  })
  async suspendUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @Body() body: SuspendUserDto,
  ) {
    await this.userRepo.update(id, { status: UserStatus.SUSPENDED });
    this.auditService.log({
      action: AuditAction.ADMIN_ACTION, userId: id, actorId,
      metadata: { action: 'suspend', reason: body.reason },
    });
    return { success: true };
  }

  @Patch('users/:id/activate')
  @ApiOperation({
    summary: 'Activate / unlock a user account',
    description: 'Clears suspension, resets failed login counter, and removes lockout.',
  })
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
  @ApiOperation({
    summary: 'Manually override a user\'s KYC tier',
    description: 'Use for manual review approvals or test accounts. Always requires a reason.',
  })
  async overrideKycTier(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @Body() body: OverrideKycTierDto,
  ) {
    await this.userRepo.update(id, { kycTier: body.tier });
    this.auditService.log({
      action: AuditAction.ADMIN_ACTION, userId: id, actorId,
      metadata: { action: 'override_kyc_tier', tier: body.tier, reason: body.reason },
    });
    return { success: true };
  }

  // ── Wallets ────────────────────────────────────────────────────────────────

  @Get('wallets/:userId')
  @ApiOperation({ summary: 'List all wallets for a specific user' })
  getUserWallets(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.walletRepo.find({ where: { userId }, order: { createdAt: 'ASC' } });
  }

  @Patch('wallets/:id/freeze')
  @ApiOperation({
    summary: 'Freeze a wallet',
    description: 'Prevents all debits and credits. Use for AML investigations.',
  })
  async freezeWallet(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @Body() body: FreezeWalletDto,
  ) {
    await this.walletRepo.update(id, { status: WalletStatus.FROZEN });
    this.auditService.log({
      action: AuditAction.WALLET_FREEZE,
      resourceType: 'wallet', resourceId: id, actorId,
      metadata: { reason: body.reason },
    });
    return { success: true };
  }

  // ── KYC Review ─────────────────────────────────────────────────────────────

  @Get('kyc/pending')
  @ApiOperation({ summary: 'List KYC submissions awaiting manual review', description: 'Returns oldest-first.' })
  getPendingKyc() {
    return this.kycRepo.find({
      where: { status: 'pending' as any },
      order: { createdAt: 'ASC' },
    });
  }

  // ── Fee Rules ──────────────────────────────────────────────────────────────

  @Get('fee-rules')
  @ApiOperation({ summary: 'List all fee rules', description: 'Includes inactive rules.' })
  listFeeRules() {
    return this.feeRuleRepo.find({ order: { currency: 'ASC', transactionType: 'ASC' } });
  }

  @Post('fee-rules')
  @ApiOperation({
    summary: 'Create a new fee rule',
    description: 'Supports flat, percentage, and tiered structures. Cache is invalidated immediately.',
  })
  async createFeeRule(
    @Body() dto: CreateFeeRuleDto,
    @CurrentUser('id') actorId: string,
  ) {
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
  @ApiOperation({
    summary: 'Update a fee rule',
    description: 'Partial update — only send fields you want to change. Cache is invalidated immediately after save.',
  })
  async updateFeeRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFeeRuleDto,
    @CurrentUser('id') actorId: string,
  ) {
    await this.feeRuleRepo.update(id, dto as any);
    const updated = await this.feeRuleRepo.findOne({ where: { id } });
    if (updated) await this.feesService.invalidateFeeCache(updated.currency, updated.transactionType);
    this.auditService.log({
      action: AuditAction.FEE_RULE_UPDATE, actorId,
      resourceType: 'fee_rule', resourceId: id,
      metadata: { action: 'update', changes: dto },
    });
    return updated;
  }

  // ── Fraud Rules ────────────────────────────────────────────────────────────

  @Get('fraud-rules')
  @ApiOperation({ summary: 'List all fraud rules ordered by priority (highest first)' })
  listFraudRules() {
    return this.fraudRuleRepo.find({ order: { priority: 'DESC' } });
  }

  @Post('fraud-rules')
  @ApiOperation({
    summary: 'Create a fraud detection rule',
    description: 'Rules are evaluated on every transfer and deposit. Takes effect immediately — no restart needed.',
  })
  createFraudRule(@Body() dto: CreateFraudRuleDto) {
    return this.fraudRuleRepo.save(this.fraudRuleRepo.create(dto));
  }

  @Patch('fraud-rules/:id')
  @ApiOperation({
    summary: 'Update a fraud rule',
    description: 'Use `isActive: false` to disable a rule without deleting it.',
  })
  updateFraudRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFraudRuleDto,
  ) {
    return this.fraudRuleRepo.update(id, dto);
  }

  // ── Fraud Alerts ───────────────────────────────────────────────────────────

  @Get('fraud-alerts')
  @ApiOperation({ summary: 'List fraud alerts', description: 'Filter by reviewed status. Defaults to all alerts.' })
  @ApiQuery({ name: 'reviewed', required: false, example: 'false', description: 'true | false' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  listFraudAlerts(
    @Query('reviewed') reviewed?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
  ) {
    return this.fraudAlertRepo.findAndCount({
      where: reviewed !== undefined ? { reviewed: reviewed === 'true' } : {},
      order: { createdAt: 'DESC' },
      skip: (page - 1) * 20,
      take: 20,
    });
  }

  @Patch('fraud-alerts/:id/review')
  @ApiOperation({
    summary: 'Mark a fraud alert as reviewed',
    description: 'Records the reviewing admin and their notes. Clears the alert from the unreviewed queue.',
  })
  async reviewFraudAlert(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @Body() body: ReviewFraudAlertDto,
  ) {
    await this.fraudAlertRepo.update(id, {
      reviewed: true,
      reviewedBy: actorId,
      reviewNotes: body.notes,
    });
    return { success: true };
  }

  // ── Reports ────────────────────────────────────────────────────────────────

  @Get('reports/platform')
  @ApiOperation({
    summary: 'Platform-wide transaction analytics',
    description: 'Aggregated by currency, type, and status. Defaults to last 30 days.',
  })
  @ApiQuery({ name: 'from', required: false, example: '2024-01-01' })
  @ApiQuery({ name: 'to', required: false, example: '2024-03-31' })
  getPlatformReport(@Query('from') from: string, @Query('to') to: string) {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400_000);
    const toDate   = to   ? new Date(to)   : new Date();
    return this.reportsService.getPlatformSummary(fromDate, toDate);
  }

  // ── Audit Logs ─────────────────────────────────────────────────────────────

  @Get('audit-logs')
  @ApiOperation({
    summary: 'Immutable compliance audit trail',
    description: 'Every significant system event. Filter by user, action type, or date range.',
  })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'action', required: false, enum: AuditAction })
  @ApiQuery({ name: 'from', required: false, example: '2024-01-01' })
  @ApiQuery({ name: 'to', required: false, example: '2024-03-31' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  getAuditLogs(
    @Query('userId') userId?: string,
    @Query('action') action?: AuditAction,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
  ) {
    return this.auditService.getLogs({
      userId,
      action,
      from: from ? new Date(from) : undefined,
      to:   to   ? new Date(to)   : undefined,
      page,
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
  ],
  controllers: [AdminController],
  providers: [AdminGuard],
})
export class AdminModule {}