import { Field, ID, ObjectType } from '@nestjs/graphql';
import { PaymentProvider, SubscriptionPlan, SubscriptionStatus } from '../../common/enums';

@ObjectType()
export class CheckoutSessionGql {
  @Field({ nullable: true })
  url?: string;

  @Field({ nullable: true })
  sessionId?: string;

  @Field()
  message: string;
}

@ObjectType()
export class BkashVerificationGql {
  @Field()
  success: boolean;

  @Field({ nullable: true })
  message?: string;
}

@ObjectType()
export class SubscriptionRecordGql {
  @Field(() => ID)
  id: string;

  @Field(() => PaymentProvider)
  provider: PaymentProvider;

  @Field(() => SubscriptionPlan)
  plan: SubscriptionPlan;

  @Field(() => SubscriptionStatus)
  status: SubscriptionStatus;

  @Field({ nullable: true })
  stripeCustomerId?: string;

  @Field({ nullable: true })
  stripeSubscriptionId?: string;
}
