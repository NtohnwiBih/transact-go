import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Wallet } from './wallet.entity';

export enum EntryType {
  CREDIT = 'credit',
  DEBIT  = 'debit',
}

export enum EntryCategory {
  DEPOSIT         = 'deposit',
  WITHDRAWAL      = 'withdrawal',
  INTERNAL_CREDIT = 'internal_credit',
  INTERNAL_DEBIT  = 'internal_debit',
  FEE             = 'fee',
  TAX             = 'tax',
  REVERSAL        = 'reversal',
  HOLD            = 'hold',
  HOLD_RELEASE    = 'hold_release',
}

@Entity('ledger_entries')
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  walletId: string;

  @ManyToOne(() => Wallet, (wallet) => wallet.ledgerEntries)
  @JoinColumn({ name: 'walletId' })
  wallet: Wallet;

  @Column({ type: 'enum', enum: EntryType })
  type: EntryType;

  @Column({ type: 'enum', enum: EntryCategory })
  category: EntryCategory;

  @Column({ type: 'bigint' })
  amount: number;

  @Column({ type: 'bigint' })
  balanceAfter: number;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  transferId: string | null;

  @Column({ type: 'text', nullable: true })       // fixed
  providerReference: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })  // fixed
  narration: string | null;

  @Column({ type: 'uuid', nullable: true })
  reversalOfId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}