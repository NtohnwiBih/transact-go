import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Observable, EMPTY } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { IdempotencyRecord } from 'src/modules/transfers/entities/idempotency-record.entity';

export const IDEMPOTENT_KEY = 'isIdempotent';

export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    @InjectRepository(IdempotencyRecord)
    private idempotencyRepo: Repository<IdempotencyRecord>,
    private reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const isIdempotent = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!isIdempotent) return next.handle();

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const idempotencyKey = request.headers['x-idempotency-key'];

    if (!idempotencyKey) {
      throw new BadRequestException(
        'X-Idempotency-Key header is required for this endpoint. ' +
        'Generate a UUID client-side and reuse it for retries.',
      );
    }

    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 16) {
      throw new BadRequestException('X-Idempotency-Key must be at least 16 characters');
    }

    const userId = request.user?.id;
    const compositeKey = `${userId}:${idempotencyKey}`;
    const endpoint = `${request.method}:${request.path}`;

    // ── Step 1: Check for existing result ──────────────────────────────────
    const existing = await this.idempotencyRepo.findOne({
      where: { compositeKey, endpoint },
    });

    if (existing) {
      if (existing.status === 'in-flight') {
        // A concurrent request with the same key is already processing
        throw new ConflictException(
          'A request with this idempotency key is already in progress. Please wait and retry.',
        );
      }

      this.logger.debug(`Idempotent hit: ${compositeKey}`);

      // Return the stored response — idempotent!
      response.status(existing.responseStatus);
      const body = { ...existing.responseBody, _idempotent: true };
      response.json(body);
      return EMPTY;
    }

    // ── Step 2: Mark as in-flight (prevents concurrent duplicates) ──────────
    const record = this.idempotencyRepo.create({
      compositeKey,
      endpoint,
      userId,
      idempotencyKey,
      status: 'in-flight',
      requestBody: request.body,
    });

    try {
      await this.idempotencyRepo.save(record);
    } catch (e) {
      // Race condition — another request just created it
      throw new ConflictException(
        'A request with this idempotency key is already in progress.',
      );
    }

    // ── Step 3: Execute the handler and save result ──────────────────────────
    return next.handle().pipe(
      tap(async (responseBody) => {
        await this.idempotencyRepo.update(
          { compositeKey, endpoint },
          {
            status: 'completed',
            responseStatus: response.statusCode,
            responseBody,
            completedAt: new Date(),
          },
        );
      }),
      catchError(async (error) => {
        // On failure: mark as failed so the client can retry with the same key
        await this.idempotencyRepo.update(
          { compositeKey, endpoint },
          {
            status: 'failed',
            responseStatus: error.status || 500,
            responseBody: { message: error.message },
            completedAt: new Date(),
          },
        );
        throw error;
      }),
    );
  }
}