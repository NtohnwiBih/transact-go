import {
  ConflictException, ForbiddenException, Injectable,
  Logger, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { KycSubmission, KycStatus } from './entities/kyc-submission.entity';
import { User, KycTier } from '../users/entities/user.entity';
import { SubmitKycDto } from './dto/kyc.dto';

export { SubmitKycDto };

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    @InjectRepository(KycSubmission) private kycRepo: Repository<KycSubmission>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectQueue('kyc') private kycQueue: Queue,
  ) {}

  async submitKyc(userId: string, dto: SubmitKycDto): Promise<KycSubmission> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.kycTier >= dto.targetTier) {
      throw new ForbiddenException(`Already at KYC Tier ${user.kycTier}`);
    }

    const existing = await this.kycRepo.findOne({
      where: { userId, targetTier: dto.targetTier, status: In([KycStatus.PENDING]) },
    });
    if (existing) throw new ConflictException('A KYC submission for this tier is already pending');

    const submission = await this.kycRepo.save(
      this.kycRepo.create({ userId, ...dto, status: KycStatus.PENDING }),
    );

    await this.kycQueue.add(
      'verify-kyc',
      { submissionId: submission.id, userId, targetTier: dto.targetTier },
      { delay: 5000, attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );

    this.logger.log(`KYC submitted: ${submission.id} for user ${userId} → tier ${dto.targetTier}`);
    return submission;
  }

  async processResult(submissionId: string, approved: boolean, reason?: string): Promise<void> {
    const submission = await this.kycRepo.findOne({ where: { id: submissionId } });
    if (!submission) return;

    if (approved) {
      await this.kycRepo.update(submissionId, {
        status: KycStatus.APPROVED,
        reviewedAt: new Date(),
        reviewedBy: 'automated_system',
      });
      await this.userRepo.update(submission.userId, { kycTier: submission.targetTier });
      this.logger.log(`KYC approved: user ${submission.userId} → tier ${submission.targetTier}`);
    } else {
      await this.kycRepo.update(submissionId, {
        status: KycStatus.REJECTED,
        rejectionReason: reason || 'Document verification failed',
        reviewedAt: new Date(),
      });
      this.logger.log(`KYC rejected: ${submissionId}`);
    }
  }

  async getUserSubmissions(userId: string): Promise<KycSubmission[]> {
    return this.kycRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }
}