import {
  Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index,
} from 'typeorm';

@Entity('idempotency_records')
export class IdempotencyRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  compositeKey: string;

  @Column()
  endpoint: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string;

  @Column()
  idempotencyKey: string;

  @Column({ default: 'in-flight' })
  status: string;

  @Column({ type: 'jsonb', nullable: true })
  requestBody: Record<string, any> | null;

  @Column({ type: 'int', nullable: true })               
  responseStatus: number;

  @Column({ type: 'jsonb', nullable: true })
  responseBody: Record<string, any> | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}