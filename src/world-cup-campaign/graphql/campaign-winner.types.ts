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

/** One row of the "most campaign wins" leaderboard. */
@ObjectType()
export class CampaignWinLeaderboardEntryGql {
  @Field(() => Int)
  rank: number;

  /** Number of campaign wins (times drawn as the winner). */
  @Field(() => Int)
  wins: number;

  /** Total prize amount across all wins. */
  @Field(() => Int)
  totalPrize: number;

  @Field(() => UserGql, { nullable: true })
  user?: UserGql | null;
}
