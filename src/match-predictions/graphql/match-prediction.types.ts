import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { UserGql } from '../../users/graphql/user.types';

@ObjectType()
export class MatchPredictionGql {
  @Field(() => ID)
  id: string;

  @Field(() => Int)
  homeScore: number;

  @Field(() => Int)
  awayScore: number;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  @Field(() => UserGql, { nullable: true })
  user?: UserGql | null;

  /** True once the match is finished and this prediction matches the final score. */
  @Field()
  isWinner: boolean;
}

/** Subscription ping — fires when any prediction on a post changes. */
@ObjectType()
export class MatchPredictionEventGql {
  @Field(() => ID)
  postId: string;
}

/** Lightweight prediction state for a single match post, scoped to the viewer. */
@ObjectType()
export class MatchPredictionStateGql {
  @Field(() => MatchPredictionGql, { nullable: true })
  myPrediction?: MatchPredictionGql | null;

  @Field(() => Int)
  count: number;

  /** Submitting/editing/deleting is allowed (before kickoff). */
  @Field()
  predictionsOpen: boolean;

  /** Match has finished — winners can be listed. */
  @Field()
  predictionsResolved: boolean;
}
