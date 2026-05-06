import {
  Entity, Column, PrimaryGeneratedColumn, CreateDateColumn,
  UpdateDateColumn, ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum TransferType {
  INTERNAL   = 'internal',
  DEPOSIT    = 'deposit',
  WITHDRAWAL = 'withdrawal',
}

export enum TransferStatus {
  PENDING    = 'pending',
  PROCESSING = 'processing',
  COMPLETED  = 'completed',
  FAILED     = 'failed',
  REVERSED   = 'reversed',
  CANCELLED  = 'cancelled',
}

@Entity('transfers')
export class Transfer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  initiatedBy: User;

  @Column({ type: 'enum', enum: TransferType })
  type: TransferType;

  @Column({ type: 'enum', enum: TransferStatus, default: TransferStatus.PENDING })
  status: TransferStatus;

  @Column({ length: 3 })
  currency: string;

  @Column({ type: 'bigint' })
  amount: number;

  @Column({ type: 'bigint', default: 0 })
  fee: number;

  @Column({ type: 'bigint', default: 0 })
  tax: number;

  @Column({ type: 'jsonb', nullable: true })
  feeBreakdown: Record<string, any> | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  sourceWalletId: string | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  destinationWalletId: string | null;

  @Column({ type: 'text', nullable: true })              
  provider: string | null;

  @Column({ type: 'text', nullable: true })              
  providerReference: string | null;

  @Column({ type: 'jsonb', nullable: true })
  providerResponse: Record<string, any> | null;

  @Column({ type: 'varchar', length: 100, nullable: true })  
  reference: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })  
  narration: string | null;

  @Column({ type: 'jsonb', nullable: true })
  recipientDetails: Record<string, any> | null;

  @Column({ type: 'text', nullable: true })              
  failureReason: string | null;

  @Column({ default: 0 })
  attempts: number;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}