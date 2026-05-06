import {
  Controller, Get, Injectable, Module,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { BullModule } from '@nestjs/bull';
import { Public } from '../../common/decorators/public.decorator';

@Injectable()
export class HealthService {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
    @InjectQueue('payments') private paymentsQueue: Queue,
  ) {}

  async check(): Promise<{
    status: 'ok' | 'degraded';
    timestamp: string;
    uptime: number;
    checks: Record<string, { status: string; latencyMs?: number; detail?: string }>;
  }> {
    const checks: Record<string, any> = {};
    let overall: 'ok' | 'degraded' = 'ok';

    // Database check
    const dbStart = Date.now();
    try {
      await this.dataSource.query('SELECT 1');
      checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
    } catch (e) {
      checks.database = { status: 'error', detail: 'Cannot reach database' };
      overall = 'degraded';
    }

    // Redis / Queue check
    const redisStart = Date.now();
    try {
      const client = this.paymentsQueue.client;
      await (client as any).ping();
      const [waiting, active, failed] = await Promise.all([
        this.paymentsQueue.getWaitingCount(),
        this.paymentsQueue.getActiveCount(),
        this.paymentsQueue.getFailedCount(),
      ]);
      checks.redis = {
        status: 'ok',
        latencyMs: Date.now() - redisStart,
        queue: { waiting, active, failed },
      };
    } catch (e) {
      checks.redis = { status: 'error', detail: 'Cannot reach Redis' };
      overall = 'degraded';
    }

    return {
      status: overall,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      checks,
    };
  }
}

@Controller('health')
export class HealthController {
  constructor(private healthService: HealthService) {}

  @Public()
  @Get()
  async check() {
    const result = await this.healthService.check();
    if (result.status === 'degraded') {
      throw new ServiceUnavailableException(result);
    }
    return result;
  }

  @Public()
  @Get('ready')
  readiness() {
    return { status: 'ready', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('live')
  liveness() {
    return { status: 'alive', timestamp: new Date().toISOString() };
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: 'payments' })],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}