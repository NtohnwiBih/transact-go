import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { AuditLog, AuditAction } from './entities/audit-log.entity';
import { Request } from 'express';

export interface LogEventParams {
  action: AuditAction;
  userId?: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, any>;
  req?: Request;
  actorId?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog) private auditRepo: Repository<AuditLog>,
  ) {}

  /**
   * Log a significant event. Fire-and-forget — never await in hot paths.
   * Usage: this.auditService.log({ action: AuditAction.TRANSFER_COMPLETE, ... })
   */
  log(params: LogEventParams): void {
    this.writeLog(params).catch((err) =>
      this.logger.error(`Audit log write failed: ${err.message}`, err.stack),
    );
  }

  private async writeLog(params: LogEventParams): Promise<void> {
    const entry = this.auditRepo.create({
      action: params.action,
      userId: params.userId ?? null,
      resourceType: params.resourceType ?? null,
      resourceId: params.resourceId ?? null,
      metadata: params.metadata ?? null,
      ipAddress: params.req ? this.extractIp(params.req) : null,
      userAgent: params.req?.headers?.['user-agent']?.substring(0, 512) ?? null,
      actorId: params.actorId ?? null,
    });
    await this.auditRepo.save(entry);
  }

  async getLogs(filters: {
    userId?: string;
    action?: AuditAction;
    resourceType?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  }) {
    const { page = 1, limit = 50 } = filters;
    const skip = (page - 1) * limit;
    const where: any = {};

    if (filters.userId)       where.userId = filters.userId;
    if (filters.action)       where.action = filters.action;
    if (filters.resourceType) where.resourceType = filters.resourceType;
    if (filters.from && filters.to) {
      where.createdAt = Between(filters.from, filters.to);
    }

    const [logs, total] = await this.auditRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip,
      take: Math.min(limit, 200),
    });

    return { logs, total, page, pages: Math.ceil(total / limit) };
  }

  private extractIp(req: Request): string {
    return (
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      'unknown'
    );
  }
}