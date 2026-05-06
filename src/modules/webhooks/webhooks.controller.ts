import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { WebhookEvent, WebhookStatus } from './entities/webhook-event.entity';
import { MockFlutterwaveProvider, MockStripeProvider } from '../payments/providers/mock-providers';
import { Throttle } from '@nestjs/throttler';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    @InjectQueue('webhooks') private webhookQueue: Queue,
    @InjectRepository(WebhookEvent) private webhookEventRepo: Repository<WebhookEvent>,
    private flutterwaveProvider: MockFlutterwaveProvider,
    private stripeProvider: MockStripeProvider,
  ) {}

  /**
   * POST /api/v1/webhooks/flutterwave
   *
   * All webhook endpoints are @Public() — providers can't authenticate with JWT.
   * Security is provided by HMAC signature verification instead.
   *
   * Critical rules:
   *  1. Verify signature FIRST — reject invalid signatures immediately (401)
   *  2. Deduplicate by providerEventId — providers retry on timeout
   *  3. Return 200 IMMEDIATELY — queue async processing
   *  4. NEVER do heavy processing in the webhook handler — it will timeout
   */
  @Public()
  @Post('flutterwave')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 1000, limit: 100 } }) // High limit — providers may burst
  async handleFlutterwave(
    @Headers('verif-hash') signature: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: any,
  ): Promise<{ received: boolean; eventId?: string }> {
    // ── Step 1: Verify signature ──────────────────────────────────────────────
    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error('No raw body available — check that rawBody: true is set in NestFactory.create()');
      throw new ForbiddenException('Cannot verify webhook signature');
    }

    const isValid = this.flutterwaveProvider.verifyWebhookSignature(signature || '', rawBody);
    if (!isValid) {
      this.logger.warn(`Invalid Flutterwave webhook signature. Payload: ${JSON.stringify(payload).substring(0, 200)}`);
      throw new ForbiddenException('Invalid webhook signature');
    }

    // ── Step 2: Extract event details ────────────────────────────────────────
    const parsedEvent = this.flutterwaveProvider.parseWebhookEvent(payload);
    const providerEventId = String(payload?.data?.id || payload?.event_id || Date.now());

    return this.processWebhookEvent({
      provider: 'flutterwave',
      providerEventId,
      eventType: parsedEvent.eventType,
      payload,
    });
  }

  /**
   * POST /api/v1/webhooks/stripe
   */
  @Public()
  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async handleStripe(
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: any,
  ): Promise<{ received: boolean; eventId?: string }> {
    const rawBody = req.rawBody;
    if (!rawBody) throw new ForbiddenException('Cannot verify webhook signature');

    const isValid = this.stripeProvider.verifyWebhookSignature(signature || '', rawBody);
    if (!isValid) {
      this.logger.warn('Invalid Stripe webhook signature');
      throw new ForbiddenException('Invalid webhook signature');
    }

    const parsedEvent = this.stripeProvider.parseWebhookEvent(payload);
    const providerEventId = payload?.id; // Stripe event IDs are like evt_xxx

    return this.processWebhookEvent({
      provider: 'stripe',
      providerEventId,
      eventType: parsedEvent.eventType,
      payload,
    });
  }

  private async processWebhookEvent(data: {
    provider: string;
    providerEventId: string;
    eventType: string;
    payload: any;
  }): Promise<{ received: boolean; eventId?: string }> {
    // ── Step 3: Deduplicate ───────────────────────────────────────────────────
    const existing = await this.webhookEventRepo.findOne({
      where: { providerEventId: data.providerEventId },
    });

    if (existing) {
      this.logger.debug(`Duplicate webhook ignored: ${data.providerEventId}`);
      return { received: true }; // 200 OK — tell provider we got it
    }

    // ── Step 4: Persist the event ─────────────────────────────────────────────
    let webhookEvent: WebhookEvent;
    try {
      webhookEvent = await this.webhookEventRepo.save(
        this.webhookEventRepo.create({
          provider: data.provider,
          providerEventId: data.providerEventId,
          eventType: data.eventType,
          payload: data.payload,
          status: WebhookStatus.PENDING,
        }),
      );
    } catch (e) {
      // Race condition — another request saved this event simultaneously
      return { received: true };
    }

    // ── Step 5: Queue for async processing ────────────────────────────────────
    // We respond 200 BEFORE the job is processed.
    // The provider considers this a success and won't retry.
    await this.webhookQueue.add(
      `process-${data.provider}-event`,
      { webhookEventId: webhookEvent.id, ...data },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 3000 }, // 3s, 6s, 12s, 24s, 48s
        removeOnComplete: 50,
        removeOnFail: 200,
      },
    );

    this.logger.log(
      `Webhook queued: ${data.provider}/${data.eventType} (${webhookEvent.id})`,
    );

    return { received: true, eventId: webhookEvent.id };
  }
}