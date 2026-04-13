import { Args, ID, Mutation, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { BillingService } from './billing.service';
import {
  BkashVerificationGql,
  CheckoutSessionGql,
} from './graphql/billing.types';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SubscriptionPlan } from '../common/enums';

type ReqUser = { id: string };

@Resolver()
export class BillingResolver {
  constructor(private billingService: BillingService) {}

  @Mutation(() => CheckoutSessionGql)
  @UseGuards(GqlAuthGuard)
  async createStripeCheckoutSession(
    @CurrentUser() user: ReqUser,
    @Args('plan', { type: () => SubscriptionPlan }) plan: SubscriptionPlan,
    @Args('organizationId', { type: () => ID, nullable: true })
    organizationId?: string,
  ) {
    return this.billingService.createStripeCheckoutSession(
      user.id,
      organizationId,
      plan,
    );
  }

  @Mutation(() => BkashVerificationGql)
  @UseGuards(GqlAuthGuard)
  async verifyBkashPayment(
    @Args('payload') payload: string,
  ): Promise<BkashVerificationGql> {
    const r = await this.billingService.verifyBkashPayment(payload);
    return { success: r.success, message: r.message };
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async cancelSubscription(
    @CurrentUser() user: ReqUser,
    @Args('organizationId', { type: () => ID, nullable: true })
    organizationId?: string,
  ) {
    return this.billingService.cancelSubscription(user.id, organizationId);
  }
}
