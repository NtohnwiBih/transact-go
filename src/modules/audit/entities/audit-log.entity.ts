import {
  Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index,
} from 'typeorm';

export enum AuditAction {
  USER_REGISTER    = 'user.register',
  USER_LOGIN       = 'user.login',
  USER_LOGOUT      = 'user.logout',
  USER_LOGIN_FAIL  = 'user.login_failed',
  KYC_SUBMIT       = 'kyc.submit',
  KYC_APPROVED     = 'kyc.approved',
  KYC_REJECTED     = 'kyc.rejected',
  WALLET_CREATE    = 'wallet.create',
  WALLET_FREEZE    = 'wallet.freeze',
  TRANSFER_INIT    = 'transfer.initiated',
  TRANSFER_COMPLETE= 'transfer.completed',
  TRANSFER_FAIL    = 'transfer.failed',
  TRANSFER_REVERSE = 'transfer.reversed',
  FRAUD_FLAGGED    = 'fraud.flagged',
  FRAUD_BLOCKED    = 'fraud.blocked',
  FEE_RULE_UPDATE  = 'fee_rule.updated',
  ADMIN_ACTION     = 'admin.action',
}

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'enum', enum: AuditAction })
  action: AuditAction;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Index()
  @Column({ type: 'text', nullable: true })      
  resourceType: string | null;

  @Column({ type: 'uuid', nullable: true })
  resourceId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @Column({ type: 'text', nullable: true })        
  ipAddress: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })  
  userAgent: string | null;

  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}