import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SubscriptionRecord,
  SubscriptionRecordDocument,
} from './subscription-record.schema';
import {
  PaymentProvider,
  SubscriptionPlan,
  SubscriptionStatus,
} from '../common/enums';
import { OrganizationsService } from '../organizations/organizations.service';

// Stripe default export is callable; avoid brittle namespace typing here.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const Stripe = require('stripe');

@Injectable()
export class BillingService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stripe: any = null;

  constructor(
    private config: ConfigService,
    @InjectModel(SubscriptionRecord.name)
    private subModel: Model<SubscriptionRecordDocument>,
    private organizationsService: OrganizationsService,
  ) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    this.stripe = key ? new Stripe(key) : null;
  }

  async createStripeCheckoutSession(
    userId: string,
    organizationId: string | undefined,
    plan: SubscriptionPlan,
  ) {
    if (plan !== SubscriptionPlan.PREMIUM) {
      throw new BadRequestException('Only premium checkout is supported');
    }
    if (!organizationId) {
      return {
        url: undefined,
        sessionId: undefined,
        message: 'organizationId is required for org premium',
      };
    }
    await this.organizationsService.assertOrgOwnedBy(organizationId, userId);
    const frontend = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');
    if (!this.stripe) {
      return {
        url: undefined,
        sessionId: undefined,
        message:
          'Stripe is not configured (set STRIPE_SECRET_KEY). Webhook: POST /webhooks/stripe',
      };
    }
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      success_url: `${frontend}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontend}/billing/cancel`,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'CTrend Org Premium' },
            unit_amount: 200,
            recurring: { interval: 'month' },
          },
          quantity: 1,
        },
      ],
      metadata: { organizationId, userId },
    });
    return {
      url: session.url ?? undefined,
      sessionId: session.id,
      message: 'Redirect user to url',
    };
  }

  async verifyBkashPayment(_payloadJson: string): Promise<{
    success: boolean;
    message?: string;
  }> {
    return {
      success: false,
      message:
        'bKash verification not implemented — integrate bKash API and set BKASH_* env vars',
    };
  }

  async cancelSubscription(userId: string, organizationId?: string) {
    const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
    if (organizationId) {
      filter.organizationId = new Types.ObjectId(organizationId);
    }
    const doc = await this.subModel.findOne(filter).sort({ createdAt: -1 });
    if (!doc) return false;
    doc.status = SubscriptionStatus.CANCELED;
    await doc.save();
    return true;
  }

  async handleStripeCheckoutCompleted(session: {
    metadata?: { organizationId?: string; userId?: string } | null;
    customer?: string | null;
    subscription?: string | null;
  }) {
    const orgId = session.metadata?.organizationId;
    if (!orgId) return;
    await this.organizationsService.setPremiumFromWebhook(
      orgId,
      typeof session.customer === 'string' ? session.customer : undefined,
      typeof session.subscription === 'string' ? session.subscription : undefined,
    );
    await this.subModel.create({
      organizationId: new Types.ObjectId(orgId),
      userId: session.metadata?.userId
        ? new Types.ObjectId(session.metadata.userId)
        : undefined,
      provider: PaymentProvider.STRIPE,
      plan: SubscriptionPlan.PREMIUM,
      status: SubscriptionStatus.ACTIVE,
      stripeCustomerId:
        typeof session.customer === 'string' ? session.customer : undefined,
      stripeSubscriptionId:
        typeof session.subscription === 'string'
          ? session.subscription
          : undefined,
      postLimit: 20,
      postsUsed: 0,
    });
  }
}
