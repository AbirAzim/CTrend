import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

/** Campaign badge on feed posts (subset of full CampaignGql). */
@ObjectType()
export class PostCampaignSummaryGql {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field(() => String, { nullable: true })
  bannerText?: string;

  @Field(() => String, { nullable: true })
  bannerImageUrl?: string;

  @Field(() => Int)
  prizePerWinner: number;

  @Field({ nullable: true })
  isDefault?: boolean;

  @Field()
  hasWinner: boolean;

  @Field()
  hasRewards: boolean;
}
