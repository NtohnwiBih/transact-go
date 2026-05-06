import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';

/**
 * Global exception filter.
 *
 * Ensures every error response has a consistent shape:
 * {
 *   statusCode, timestamp, path, method,
 *   error: { code, message, details? }
 * }
 *
 * Also handles TypeORM database errors gracefully — e.g. unique constraint
 * violations become 409 Conflict instead of 500 Internal Server Error.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorCode = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details: any = undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const res = exceptionResponse as any;
        message = res.message || message;
        details = Array.isArray(res.message) ? res.message : undefined;
        errorCode = res.error || this.statusToCode(statusCode);
      }
    } else if (exception instanceof QueryFailedError) {
      // Handle PostgreSQL-specific errors
      const pgError = exception as any;

      switch (pgError.code) {
        case '23505': // unique_violation
          statusCode = HttpStatus.CONFLICT;
          errorCode = 'DUPLICATE_ENTRY';
          message = this.parseUniqueConstraintMessage(pgError.detail);
          break;
        case '23503': // foreign_key_violation
          statusCode = HttpStatus.BAD_REQUEST;
          errorCode = 'INVALID_REFERENCE';
          message = 'Referenced resource does not exist';
          break;
        case '23514': // check_violation
          statusCode = HttpStatus.BAD_REQUEST;
          errorCode = 'CONSTRAINT_VIOLATION';
          message = 'Data violates a database constraint';
          break;
        default:
          this.logger.error(`Unhandled DB error: ${pgError.code}`, pgError.message);
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    }

    // Always log 5xx errors
    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(statusCode).json({
      statusCode,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      error: {
        code: errorCode,
        message,
        ...(details ? { details } : {}),
      },
      // Include request ID if set by middleware (useful for distributed tracing)
      ...(request.headers['x-request-id']
        ? { requestId: request.headers['x-request-id'] }
        : {}),
    });
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_ERROR',
    };
    return map[status] || 'HTTP_ERROR';
  }

  private parseUniqueConstraintMessage(detail: string): string {
    if (!detail) return 'Resource already exists';
    // Parse "Key (email)=(test@test.com) already exists."
    const match = detail.match(/Key \((.+)\)=\((.+)\) already exists/);
    if (match) return `${match[1]} '${match[2]}' is already taken`;
    return 'Resource already exists';
  }
}