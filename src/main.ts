import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as winston from 'winston';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = WinstonModule.createLogger({
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          winston.format.errors({ stack: true }),
          // In production, use json() for structured logs (Grafana/CloudWatch)
          process.env.NODE_ENV === 'production'
            ? winston.format.json()
            : winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, context, stack }) => {
                  return `${timestamp} [${context || 'App'}] ${level}: ${message}${stack ? '\n' + stack : ''}`;
                }),
              ),
        ),
      }),
      // In production, also write to files
      ...(process.env.NODE_ENV === 'production'
        ? [
            new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
            new winston.transports.File({ filename: 'logs/combined.log' }),
          ]
        : []),
    ],
  });

  const app = await NestFactory.create(AppModule, {
    logger,
    // rawBody: true is REQUIRED for webhook HMAC signature verification.
    // Without it, express parses the body before we can compute the hash.
    rawBody: true,
  });

  const configService = app.get(ConfigService);

  // Security headers
  app.use(helmet());

  // Global API prefix and versioning
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Global validation pipe
  // whitelist: strips any properties not in the DTO — critical for fintech
  // forbidNonWhitelisted: throws 400 if unknown properties are sent
  // transform: auto-converts plain objects to DTO class instances
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global exception filter — ensures consistent error response shape
  app.useGlobalFilters(new HttpExceptionFilter());

  // CORS — tighten in production to your actual frontend domain
  app.enableCors({
    origin: process.env.NODE_ENV === 'production' ? process.env.ALLOWED_ORIGINS?.split(',') : '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key'],
  });

  // ── Swagger / OpenAPI ─────────────────────────────────────────────────────
  // Only expose docs in non-production environments
  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('TransactGo — Fintech API')
      .setDescription(
        'Production-grade wallet & payments platform.\n\n' +
        '**Auth:** Click **Authorize** and paste your `accessToken` as `Bearer <token>`.\n\n' +
        '**Idempotency:** `POST /transfers/*` and `POST /payments/*` require an ' +
        '`X-Idempotency-Key` header. Generate a UUID once per intent and reuse it on retries.',
      )
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
        'access-token',
      )
      .addApiKey(
        { type: 'apiKey', in: 'header', name: 'X-Idempotency-Key' },
        'idempotency-key',
      )
      .addServer('http://localhost:3004', 'Local')
      .addTag('Auth', 'Registration, login, token refresh')
      .addTag('KYC', 'Identity verification (tiered)')
      .addTag('Wallets', 'Multi-currency wallet management')
      .addTag('Transfers', 'Internal wallet-to-wallet transfers')
      .addTag('Payments', 'External deposits and withdrawals')
      .addTag('Exchange Rates', 'Live FX rates and currency conversion')
      .addTag('Reports', 'Account statements and analytics')
      .addTag('Webhooks', 'Payment provider callbacks')
      .addTag('Admin', 'Operations panel — users, rules, alerts')
      .addTag('Health', 'Liveness and readiness probes')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,       // keeps token across page refreshes
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
        docExpansion: 'list',             // collapse all by default
        filter: true,                     // search bar
        tryItOutEnabled: true,            // "Try it out" open by default
      },
      customSiteTitle: 'TransactGo API Docs',
    });
  }

  const port = configService.get<number>('PORT', 3004);
  await app.listen(port);

  logger.log(`🚀 Fintech API running on http://localhost:${port}/api/v1`, 'Bootstrap');
  logger.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`, 'Bootstrap');
}

bootstrap();