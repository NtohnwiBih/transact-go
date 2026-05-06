import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User, KycTier } from '../../users/entities/user.entity';

export enum KycStatus {
  PENDING  = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPIRED  = 'expired',
}

export enum DocumentType {
  NIN              = 'nin',
  BVN              = 'bvn',
  PASSPORT         = 'passport',
  DRIVERS_LIC      = 'drivers_license',
  VOTERS_CARD      = 'voters_card',
  PROOF_OF_ADDRESS = 'proof_of_address',
}

@Entity('kyc_submissions')
export class KycSubmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'int' })
  targetTier: KycTier;

  @Column({ type: 'enum', enum: KycStatus, default: KycStatus.PENDING })
  status: KycStatus;

  @Column({ type: 'enum', enum: DocumentType })
  documentType: DocumentType;

  @Column({ type: 'text', nullable: true })   
  documentReference: string | null;

  @Column({ type: 'text', nullable: true })   
  documentNumber: string | null;

  @Column({ type: 'jsonb', nullable: true })
  providerResponse: Record<string, any> | null;

  @Column({ type: 'text', nullable: true })  
  rejectionReason: string | null;

  @Column({ type: 'text', nullable: true })   
  reviewedBy: string | null;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}