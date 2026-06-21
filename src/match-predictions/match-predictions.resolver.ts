import {
  Args,
  ID,
  Int,
  Mutation,
  Query,
  Resolver,
  Subscription,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { MatchPredictionsService } from './match-predictions.service';
import {
  MatchPredictionEventGql,
  MatchPredictionGql,
  MatchPredictionStateGql,
} from './graphql/match-prediction.types';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { OptionalJwtGqlGuard } from '../common/guards/optional-jwt-gql.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { pubsub, MATCH_PREDICTION_UPDATED } from '../pubsub';

type ReqUser = { id: string; role: string };

@Resolver()
export class MatchPredictionsResolver {
  constructor(private readonly service: MatchPredictionsService) {}

  /** Viewer-scoped state: my prediction, total count, open/resolved flags. */
  @Query(() => MatchPredictionStateGql)
  @UseGuards(OptionalJwtGqlGuard)
  async matchPredictionState(
    @Args('postId', { type: () => ID }) postId: string,
    @CurrentUser() user?: ReqUser,
  ) {
    return this.service.getState(postId, user?.id);
  }

  /** All predictions for a post (visible to everyone, live). */
  @Query(() => [MatchPredictionGql])
  async matchPredictions(
    @Args('postId', { type: () => ID }) postId: string,
    @Args('skip', { type: () => Int, nullable: true }) skip?: number,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    return this.service.list(postId, skip ?? 0, take);
  }

  /** Users whose exact score matches the final result (only after the match). */
  @Query(() => [MatchPredictionGql])
  async matchPredictionWinners(
    @Args('postId', { type: () => ID }) postId: string,
  ) {
    return this.service.listWinners(postId);
  }

  @Mutation(() => MatchPredictionGql)
  @UseGuards(GqlAuthGuard)
  async submitMatchPrediction(
    @CurrentUser() user: ReqUser,
    @Args('postId', { type: () => ID }) postId: string,
    @Args('homeScore', { type: () => Int }) homeScore: number,
    @Args('awayScore', { type: () => Int }) awayScore: number,
  ) {
    return this.service.submit(user.id, postId, homeScore, awayScore);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async deleteMatchPrediction(
    @CurrentUser() user: ReqUser,
    @Args('postId', { type: () => ID }) postId: string,
  ) {
    return this.service.remove(user.id, postId);
  }

  @Subscription(() => MatchPredictionEventGql, {
    filter: (
      payload: { matchPredictionUpdated: { postId: string } },
      variables: { postId: string },
    ) => payload.matchPredictionUpdated.postId === variables.postId,
    resolve: (payload: { matchPredictionUpdated: MatchPredictionEventGql }) =>
      payload.matchPredictionUpdated,
  })
  matchPredictionUpdated(@Args('postId', { type: () => ID }) postId: string) {
    void postId; // bound by @Subscription.filter
    return pubsub.asyncIterableIterator(MATCH_PREDICTION_UPDATED);
  }
}
