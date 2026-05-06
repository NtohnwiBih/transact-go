import {
  Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index,
} from 'typeorm';

@Entity('exchange_rates')
@Index(['fromCurrency', 'toCurrency'])
export class ExchangeRate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 3 })
  fromCurrency: string;

  @Column({ length: 3 })
  toCurrency: string;

  // Rate stored with high precision: 1 fromCurrency = rate toCurrency
  @Column({ type: 'decimal', precision: 18, scale: 8 })
  rate: number;

  // Spread applied on top of mid-market rate (e.g. 0.02 = 2%)
  @Column({ type: 'decimal', precision: 5, scale: 4, default: 0.02 })
  spread: number;

  // Source of the rate (mock, openexchangerates, etc.)
  @Column({ default: 'mock' })
  source: string;

  @Column({ type: 'timestamp' })
  validAt: Date;

  // Rate expires after this time — force refresh
  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}