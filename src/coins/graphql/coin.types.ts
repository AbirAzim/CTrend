import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { UserGql } from '../../users/graphql/user.types';

@ObjectType()
export class CoinHistoryItemGql {
  @Field(() => ID)
  id: string;

  /** Event type — HYPE, VOTE, PREDICTION, POST, COMMENT, POST_HYPED, … */
  @Field()
  type: string;

  @Field(() => Int)
  amount: number;

  @Field()
  createdAt: Date;

  /** Invitee (INVITE) or inviter (REFERRAL_INVITEE) — referral history only. */
  @Field(() => ID, { nullable: true })
  relatedUserId?: string;

  @Field({ nullable: true })
  relatedUserName?: string;
}

@ObjectType()
export class CoinLeaderboardEntryGql {
  @Field(() => Int)
  rank: number;

  @Field(() => Int)
  coins: number;

  @Field(() => UserGql)
  user: UserGql;
}

@ObjectType()
export class DailyStreakGql {
  /** Coins awarded by this claim (0 if already claimed today). */
  @Field(() => Int)
  awarded: number;

  @Field(() => Int)
  balance: number;

  @Field(() => Int)
  streakDays: number;
}
