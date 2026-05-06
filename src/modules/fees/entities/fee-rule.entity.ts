import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum FeeType {
  FLAT       = 'flat',       
  PERCENTAGE = 'percentage',  
  TIERED     = 'tiered',      
}


@Entity('fee_rules')
@Index(['currency', 'transactionType', 'isActive'])
export class FeeRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 100, unique: true })
  ruleCode: string;

  @Column({ length: 3 })
  currency: string;

  @Column()
  transactionType: string;

  @Column({ type: 'enum', enum: FeeType })
  feeType: FeeType;

  @Column({ type: 'bigint', default: 0 })
  flatAmount: number;

  @Column({ type: 'decimal', precision: 8, scale: 6, default: 0 })
  percentage: number;

  @Column({ type: 'bigint', nullable: true })
  cap: number | null;

  @Column({ type: 'bigint', nullable: true })
  floor: number | null;

  @Column({ type: 'jsonb', nullable: true })
  tierConfig: Array<{
    minAmount: number;
    maxAmount: number | null;
    flatFee: number;
  }> | null;

  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0 })
  taxRate: number;

  @Column({ type: 'bigint', default: 0 })
  minTransferAmount: number;

  @Column({ type: 'bigint', nullable: true })
  maxTransferAmount: number | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: 0 })
  priority: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}