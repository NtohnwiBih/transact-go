import { Process, Processor, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { KycService } from './kyc.service';

interface VerifyKycJobData {
  submissionId: string;
  userId: string;
  targetTier: number;
}

@Processor('kyc')
export class KycProcessor {
  private readonly logger = new Logger(KycProcessor.name);

  constructor(private kycService: KycService) {}

  @Process('verify-kyc')
  async handleVerification(job: Job<VerifyKycJobData>): Promise<void> {
    const { submissionId, userId, targetTier } = job.data;
    this.logger.log(`Processing KYC verification: ${submissionId}`);

    // Simulate external provider call (Smile Identity, Youverify, etc.)
    // In production: call the real provider SDK here
    await this.simulateProviderDelay();

    // 95% approval rate in simulation
    const approved = Math.random() > 0.05;
    const reason = approved ? undefined : 'Could not verify document authenticity';

    await this.kycService.processResult(submissionId, approved, reason);
    job.log(`KYC ${approved ? 'approved' : 'rejected'} for user ${userId} → tier ${targetTier}`);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`KYC job ${job.id} failed: ${error.message}`, error.stack);
  }

  @OnQueueCompleted()
  onCompleted(job: Job) {
    this.logger.debug(`KYC job ${job.id} completed`);
  }

  private simulateProviderDelay(): Promise<void> {
    const ms = 2000 + Math.random() * 3000; // 2–5s
    return new Promise((r) => setTimeout(r, ms));
  }
}