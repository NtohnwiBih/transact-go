import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { v4 as uuid } from 'uuid';

export interface ChargeParams {
  amount: number;
  currency: string;
  reference: string;
  customerEmail?: string;
  metadata?: Record<string, any>;
}

export interface ChargeResult {
  status: 'success' | 'pending' | 'failed';
  providerReference: string;
  amount: number;
  currency: string;
  message: string;
  rawResponse: Record<string, any>;
}

export interface PaymentProvider {
  name: string;
  charge(params: ChargeParams): Promise<ChargeResult>;
  verifyWebhookSignature(signature: string, rawBody: Buffer): boolean;
  parseWebhookEvent(payload: any): { eventType: string; reference: string; status: string };
}

/**
 * Mock Flutterwave Provider
 *
 * Simulates the Flutterwave payment API behavior:
 *  - 90% success rate
 *  - 8% pending (async confirmation via webhook)
 *  - 2% failure
 *  - 800ms–3s latency
 *
 * In production: replace the charge() implementation with:
 *   const response = await fetch('https://api.flutterwave.com/v3/charges', { ... })
 */
@Injectable()
export class MockFlutterwaveProvider implements PaymentProvider {
  name = 'flutterwave';
  private readonly logger = new Logger(MockFlutterwaveProvider.name);
  private readonly secretHash = process.env.FLUTTERWAVE_SECRET_HASH || 'flw_mock_hash';

  async charge(params: ChargeParams): Promise<ChargeResult> {
    // Simulate network latency (800ms to 3s)
    const latency = 800 + Math.random() * 2200;
    await this.sleep(latency);

    // Simulate success/failure rates
    const rand = Math.random();
    let status: 'success' | 'pending' | 'failed';
    let message: string;

    if (rand > 0.1) {
      status = 'success';
      message = 'Transaction was successful.';
    } else if (rand > 0.02) {
      status = 'pending';
      message = 'Transaction is pending confirmation.';
    } else {
      status = 'failed';
      message = 'Transaction failed. Insufficient funds.';
    }

    const providerReference = `FLW-${uuid().replace(/-/g, '').substring(0, 12).toUpperCase()}`;

    this.logger.debug(
      `Mock FLW charge: ref=${params.reference} status=${status} latency=${Math.round(latency)}ms`,
    );

    return {
      status,
      providerReference,
      amount: params.amount,
      currency: params.currency,
      message,
      rawResponse: {
        status: status === 'success' ? 'successful' : status,
        data: {
          id: Math.floor(Math.random() * 9999999),
          tx_ref: params.reference,
          flw_ref: providerReference,
          amount: params.amount / 100, // Flutterwave uses major currency units
          currency: params.currency,
          charged_amount: params.amount / 100,
          status: status === 'success' ? 'successful' : status,
          created_at: new Date().toISOString(),
        },
      },
    };
  }

  verifyWebhookSignature(signature: string, rawBody: Buffer): boolean {
    const expected = createHmac('sha256', this.secretHash)
      .update(rawBody)
      .digest('hex');

    try {
      return timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expected, 'hex'),
      );
    } catch {
      return false; // Buffer lengths differ → definitely invalid
    }
  }

  parseWebhookEvent(payload: any): { eventType: string; reference: string; status: string } {
    return {
      eventType: payload?.event || 'charge.completed',
      reference: payload?.data?.tx_ref,
      status: payload?.data?.status === 'successful' ? 'success' : payload?.data?.status,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Mock Stripe Provider
 *
 * Simulates Stripe's charge + webhook flow.
 * Stripe uses HMAC-SHA256 with a timestamp prefix for replay protection.
 */
@Injectable()
export class MockStripeProvider implements PaymentProvider {
  name = 'stripe';
  private readonly logger = new Logger(MockStripeProvider.name);
  private readonly webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_mock';

  async charge(params: ChargeParams): Promise<ChargeResult> {
    await this.sleep(500 + Math.random() * 1500);

    const rand = Math.random();
    const status: 'success' | 'failed' = rand > 0.05 ? 'success' : 'failed';
    const providerReference = `ch_${uuid().replace(/-/g, '').substring(0, 24)}`;

    this.logger.debug(`Mock Stripe charge: ref=${params.reference} status=${status}`);

    return {
      status,
      providerReference,
      amount: params.amount,
      currency: params.currency.toLowerCase(),
      message: status === 'success' ? 'Payment succeeded' : 'Your card was declined.',
      rawResponse: {
        id: providerReference,
        object: 'charge',
        amount: params.amount,
        currency: params.currency.toLowerCase(),
        status: status === 'success' ? 'succeeded' : 'failed',
        metadata: { reference: params.reference },
        created: Math.floor(Date.now() / 1000),
      },
    };
  }

  verifyWebhookSignature(signature: string, rawBody: Buffer): boolean {
    // Stripe format: "t=timestamp,v1=hmac_signature"
    const parts = signature.split(',');
    const timestamp = parts.find((p) => p.startsWith('t='))?.split('=')[1];
    const v1 = parts.find((p) => p.startsWith('v1='))?.split('=')[1];

    if (!timestamp || !v1) return false;

    const payload = `${timestamp}.${rawBody.toString()}`;
    const expected = createHmac('sha256', this.webhookSecret)
      .update(payload)
      .digest('hex');

    try {
      return timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  parseWebhookEvent(payload: any): { eventType: string; reference: string; status: string } {
    return {
      eventType: payload?.type || 'payment_intent.succeeded',
      reference: payload?.data?.object?.metadata?.reference,
      status: payload?.data?.object?.status === 'succeeded' ? 'success' : 'failed',
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}