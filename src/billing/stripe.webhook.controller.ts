import {
  Controller,
  Headers,
  Post,
  Req,
  BadRequestException,
  RawBodyRequest,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { BillingService } from './billing.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const Stripe = require('stripe');

@Controller('webhooks/stripe')
export class StripeWebhookController {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stripe: any = null;

  constructor(
    private config: ConfigService,
    private billingService: BillingService,
  ) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    this.stripe = key ? new Stripe(key) : null;
  }

  @Post()
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') sig: string | undefined,
  ) {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!this.stripe || !secret) {
      throw new BadRequestException('Stripe webhook not configured');
    }
    const raw = req.rawBody;
    if (!raw || !sig) {
      throw new BadRequestException('Missing body or signature');
    }
    let event: { type: string; data: { object: Record<string, unknown> } };
    try {
      event = this.stripe.webhooks.constructEvent(raw, sig, secret);
    } catch {
      throw new BadRequestException('Invalid signature');
    }
    switch (event.type) {
      case 'checkout.session.completed': {
        const o = event.data.object as {
          metadata?: { organizationId?: string; userId?: string };
          customer?: string | null;
          subscription?: string | null;
        };
        await this.billingService.handleStripeCheckoutCompleted(o);
        break;
      }
      case 'invoice.paid':
      case 'invoice.payment_failed':
      case 'customer.subscription.deleted':
        break;
      default:
        break;
    }
    return { received: true };
  }
}
