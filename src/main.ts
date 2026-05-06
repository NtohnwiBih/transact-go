import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { WinstonModule } from 'nest-winston';
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
    rawBody: true,
  });

  const configService = app.get(ConfigService);

  // Helmet must be configured to allow Swagger UI assets
  app.use(
    helmet({
      contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
    }),
  );

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableCors({
    origin: process.env.NODE_ENV === 'production' ? process.env.ALLOWED_ORIGINS?.split(',') : '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key'],
  });

  // ── Swagger ────────────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('TransactGo API')
      .setDescription('Fintech payment & wallet API')
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
        'access-token',
      )
      .addServer(`http://localhost:${configService.get('PORT', 3004)}`, 'Local')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,  // keeps JWT across page refreshes
      },
    });

    logger.log(`📖 Swagger UI: http://localhost:${configService.get('PORT', 3004)}/api/docs`, 'Bootstrap');
  }

  const port = configService.get<number>('PORT', 3004);
  await app.listen(port);

  logger.log(`🚀 TransactGo API running on http://localhost:${port}/api/v1`, 'Bootstrap');
  logger.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`, 'Bootstrap');
}

bootstrap();