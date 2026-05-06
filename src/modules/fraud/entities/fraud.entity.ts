import {
  Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index,
} from 'typeorm';

export enum FraudRuleType {
  VELOCITY         = 'velocity',
  DAILY_LIMIT      = 'daily_limit',
  LARGE_AMOUNT     = 'large_amount',
  UNUSUAL_PATTERN  = 'unusual_pattern',
  BLACKLIST        = 'blacklist',
}

export enum FraudAction {
  BLOCK  = 'block',
  FLAG   = 'flag',
  NOTIFY = 'notify',
}

@Entity('fraud_rules')
export class FraudRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'enum', enum: FraudRuleType })
  ruleType: FraudRuleType;

  @Index()
  @Column({ type: 'varchar', length: 3, nullable: true })  
  currency: string | null;

  @Column({ type: 'int', nullable: true })
  kycTier: number | null;

  @Column({ type: 'jsonb' })
  config: Record<string, any>;

  @Column({ type: 'enum', enum: FraudAction })
  action: FraudAction;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: 0 })
  priority: number;

  @CreateDateColumn()
  createdAt: Date;
}

@Entity('fraud_alerts')
export class FraudAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'uuid', nullable: true })
  transferId: string | null;

  @Column()
  ruleTriggered: string;

  @Column({ type: 'enum', enum: FraudAction })
  actionTaken: FraudAction;

  @Column({ type: 'jsonb' })
  context: Record<string, any>;

  @Column({ default: false })
  reviewed: boolean;

  @Column({ type: 'text', nullable: true })   
  reviewedBy: string | null;

  @Column({ type: 'text', nullable: true })   
  reviewNotes: string | null;

  @CreateDateColumn()
  createdAt: Date;
}