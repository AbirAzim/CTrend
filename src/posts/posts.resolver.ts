import { Args, ID, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { NotFoundException, UseGuards } from '@nestjs/common';
import { PostsService } from './posts.service';
import { PostGql } from './graphql/post.types';
import { CreatePostInput } from './dto/create-post.input';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { OptionalJwtGqlGuard } from '../common/guards/optional-jwt-gql.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { POST_VOTE_UPDATED, pubsub } from '../pubsub';

type ReqUser = { id: string };

@Resolver(() => PostGql)
export class PostsResolver {
  constructor(private postsService: PostsService) {}

  @Mutation(() => PostGql)
  @UseGuards(GqlAuthGuard)
  async createPost(
    @CurrentUser() user: ReqUser,
    @Args('input') input: CreatePostInput,
  ) {
    const post = await this.postsService.create(user.id, input);
    return this.postsService.toGql(post, user.id);
  }

  @Mutation(() => PostGql)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async createSystemPost(
    @CurrentUser() user: ReqUser,
    @Args('input') input: CreatePostInput,
  ) {
    const post = await this.postsService.createSystemPost(user.id, input);
    return this.postsService.toGql(post, user.id);
  }

  @Mutation(() => PostGql)
  @UseGuards(GqlAuthGuard)
  async extendPostVoting(
    @CurrentUser() user: ReqUser,
    @Args('postId', { type: () => ID }) postId: string,
    @Args('newVotingEndsAt', { type: () => Date }) newVotingEndsAt: Date,
  ) {
    const post = await this.postsService.extendVotingWindow(
      user.id,
      postId,
      newVotingEndsAt.toISOString(),
    );
    return this.postsService.toGql(post, user.id);
  }

  @Query(() => PostGql)
  @UseGuards(OptionalJwtGqlGuard)
  async getPostById(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user?: ReqUser,
  ) {
    const post = await this.postsService.findById(id);
    if (!post) throw new NotFoundException('Post not found');
    return this.postsService.toGql(post, user?.id);
  }

  @Query(() => [PostGql])
  @UseGuards(OptionalJwtGqlGuard)
  async getPostsByUser(
    @Args('userId', { type: () => ID }) userId: string,
    @CurrentUser() user?: ReqUser,
  ) {
    const rows = await this.postsService.findByAuthor(userId);
    return Promise.all(
      rows.map((p) => this.postsService.toGql(p, user?.id)),
    );
  }

  @Subscription(() => PostGql, {
    filter: (
      payload: { postVoteUpdated: { postId: string } },
      variables: { postId: string },
    ) => payload.postVoteUpdated.postId === variables.postId,
    resolve: async function (
      this: PostsResolver,
      payload: { postVoteUpdated: { postId: string } },
      _variables: { postId: string },
      context: { req?: { user?: ReqUser } },
    ) {
      const post = await this.postsService.findById(payload.postVoteUpdated.postId);
      if (!post) throw new NotFoundException('Post not found');
      return this.postsService.toGql(post, context.req?.user?.id);
    },
  })
  postVoteUpdated(@Args('postId', { type: () => ID }) _postId: string) {
    return pubsub.asyncIterableIterator(POST_VOTE_UPDATED);
  }
}
