import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { SubscriptionPlan } from '../../common/enums';

@ObjectType()
export class OrganizationGql {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field(() => ID)
  ownerUserId: string;

  @Field(() => SubscriptionPlan)
  subscriptionPlan: SubscriptionPlan;

  @Field(() => Int)
  postLimit: number;

  @Field(() => Int)
  postsUsed: number;

  @Field(() => Int)
  globalPostsThisMonth: number;
}

@ObjectType()
export class OrganizationDashboardGql {
  @Field(() => Int)
  totalPosts: number;

  @Field(() => Int)
  totalVotes: number;

  @Field(() => Int)
  totalComments: number;

  @Field(() => Int)
  estimatedReach: number;
}
