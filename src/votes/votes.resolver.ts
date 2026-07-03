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
import { VotesService } from './votes.service';
import {
  PostVoterGql,
  VoteResultGql,
  VoteUpdateGql,
} from './graphql/vote.types';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { pubsub, VOTE_UPDATED } from '../pubsub';

type ReqUser = { id: string };

@Resolver()
export class VotesResolver {
  constructor(private votesService: VotesService) {}

  @Mutation(() => VoteResultGql)
  @UseGuards(GqlAuthGuard)
  async votePost(
    @CurrentUser() user: ReqUser,
    @Args('postId', { type: () => ID }) postId: string,
    @Args('selectedOptionIndex', { type: () => Int })
    selectedOptionIndex: number,
    @Args('anonymous', { nullable: true }) anonymous?: boolean,
  ) {
    return this.votesService.vote(
      user.id,
      postId,
      selectedOptionIndex,
      !!anonymous,
    );
  }

  @Mutation(() => VoteResultGql)
  @UseGuards(GqlAuthGuard)
  async removeVote(
    @CurrentUser() user: ReqUser,
    @Args('postId', { type: () => ID }) postId: string,
  ) {
    return this.votesService.removeVote(user.id, postId);
  }

  /**
   * How many (non-anonymous) votes a user has cast — shown on their profile.
   * Anonymous votes are excluded so a user's private votes stay private.
   */
  @Query(() => Int)
  @UseGuards(GqlAuthGuard)
  async userVoteCount(@Args('userId', { type: () => ID }) userId: string) {
    return this.votesService.countVotesByUser(userId);
  }

  @Query(() => [PostVoterGql])
  async votersByPost(
    @Args('postId', { type: () => ID }) postId: string,
    @Args('optionIndex', { type: () => Int, nullable: true })
    optionIndex?: number,
    @Args('search', { type: () => String, nullable: true })
    search?: string,
    @Args('skip', { type: () => Int, nullable: true }) skip?: number,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    return this.votesService.listVoters(
      postId,
      optionIndex,
      search,
      skip ?? 0,
      take,
    );
  }

  @Subscription(() => VoteUpdateGql, {
    filter: (
      payload: { voteUpdated: { postId: string } },
      variables: { postId: string },
    ) => payload.voteUpdated.postId === variables.postId,
    resolve: (payload: { voteUpdated: VoteUpdateGql }) => payload.voteUpdated,
  })
  voteUpdates(@Args('postId', { type: () => ID }) postId: string) {
    // Arg required for subscription variable binding; `@Subscription.filter` compares `variables.postId`.
    void postId;
    return pubsub.asyncIterableIterator(VOTE_UPDATED);
  }
}
