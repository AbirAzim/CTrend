import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { UserGql } from '../../users/graphql/user.types';

@ObjectType()
export class CampaignWinnerGql {
  @Field(() => ID)
  id: string;

  @Field(() => ID, { nullable: true })
  campaignId?: string;

  @Field(() => ID)
  fixtureId: string;

  @Field(() => ID)
  postId: string;

  @Field(() => UserGql, { nullable: true })
  user?: UserGql | null;

  @Field(() => Int)
  prize: number;

  @Field(() => Int, { nullable: true })
  winningOption?: number;

  @Field()
  paid: boolean;

  @Field(() => String, { nullable: true })
  note?: string;

  @Field()
  createdAt: Date;
}
