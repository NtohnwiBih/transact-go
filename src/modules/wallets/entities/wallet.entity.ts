import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
  Check,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { LedgerEntry } from './ledger-entry.entity';

export enum WalletStatus {
  ACTIVE    = 'active',
  FROZEN    = 'frozen',   
  CLOSED    = 'closed',
}

export enum Currency {
  NGN = 'NGN',
  USD = 'USD',
  GHS = 'GHS',
  KES = 'KES',
  ZAR = 'ZAR',
  EUR = 'EUR',
  GBP = 'GBP',
}

@Entity('wallets')
@Check('"balance" >= 0') 
@Index(['userId', 'currency'], { unique: true }) 
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'enum', enum: Currency })
  currency: Currency;

  @Column({ type: 'bigint', default: 0 })
  balance: number;

  @Column({ type: 'bigint', default: 0 })
  heldBalance: number;

  @Column({ type: 'enum', enum: WalletStatus, default: WalletStatus.ACTIVE })
  status: WalletStatus;

  @Column({ type: 'varchar', length: 100, nullable: true }) 
  label: string | null;

  @OneToMany(() => LedgerEntry, (entry) => entry.wallet)
  ledgerEntries: LedgerEntry[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  get availableBalance(): number {
    return this.balance - this.heldBalance;
  }
}