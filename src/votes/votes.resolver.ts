import { Args, ID, Int, Mutation, Resolver, Subscription } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { VotesService } from './votes.service';
import { VoteResultGql, VoteUpdateGql } from './graphql/vote.types';
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
    @Args('selectedOptionIndex', { type: () => Int }) selectedOptionIndex: number,
  ) {
    return this.votesService.vote(user.id, postId, selectedOptionIndex);
  }

  @Subscription(() => VoteUpdateGql, {
    filter: (
      payload: { voteUpdated: { postId: string } },
      variables: { postId: string },
    ) => payload.voteUpdated.postId === variables.postId,
    resolve: (payload: { voteUpdated: VoteUpdateGql }) => payload.voteUpdated,
  })
  voteUpdates(@Args('postId', { type: () => ID }) _postId: string) {
    return pubsub.asyncIterableIterator(VOTE_UPDATED);
  }
}
