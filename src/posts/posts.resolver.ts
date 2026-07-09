import {
  Args,
  ID,
  Int,
  Mutation,
  Query,
  Resolver,
  Subscription,
} from '@nestjs/graphql';
import { NotFoundException, UseGuards } from '@nestjs/common';
import { PostsService } from './posts.service';
import {
  PostGql,
  MyContentSummaryGql,
  PostReactionSummaryGql,
  PostHyperGql,
} from './graphql/post.types';
import { PostCampaignSummaryGql } from './graphql/post-campaign-summary.types';
import { PostVoteWinnerGql } from './graphql/post-vote-winner.types';

/** Ensure code-first schema registers nested post types. */
void PostCampaignSummaryGql;
void PostVoteWinnerGql;
import { CreatePostInput } from './dto/create-post.input';
import { UpdatePostInput } from './dto/update-post.input';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { OptionalJwtGqlGuard } from '../common/guards/optional-jwt-gql.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PostStatus, UserRole } from '../common/enums';
import {
  AdminPlatformPostsFilterInput,
  AdminPlatformPostsQueryInput,
} from './dto/admin-platform-posts.input';
import {
  AdminReportedPostsFilterInput,
  AdminReportedPostsQueryInput,
} from './dto/admin-reported-posts.input';
import { POST_UPDATED, POST_VOTE_UPDATED, pubsub } from '../pubsub';

type ReqUser = { id: string; role: string };

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

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async setPostKeep(
    @CurrentUser() user: ReqUser,
    @Args('postId', { type: () => ID }) postId: string,
    @Args('keep') keep: boolean,
  ) {
    return this.postsService.setSaved(user.id, postId, keep);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async setPostLike(
    @CurrentUser() user: ReqUser,
    @Args('postId', { type: () => ID }) postId: string,
    @Args('active') active: boolean,
  ) {
    await this.postsService.setReaction(user.id, postId, 'like', active);
    return active;
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async setPostHype(
    @CurrentUser() user: ReqUser,
    @Args('postId', { type: () => ID }) postId: string,
    @Args('active') active: boolean,
  ) {
    await this.postsService.setReaction(user.id, postId, 'hype', active);
    return active;
  }

  /** Full 6-emoji reaction set (👍 ❤️ 😂 😮 😢 🔥). Pass `emoji: null` to clear. */
  @Mutation(() => PostReactionSummaryGql)
  @UseGuards(GqlAuthGuard)
  async setPostReaction(
    @CurrentUser() user: ReqUser,
    @Args('postId', { type: () => ID }) postId: string,
    @Args('emoji', { type: () => String, nullable: true }) emoji: string | null,
  ) {
    return this.postsService.setPostReaction(user.id, postId, emoji);
  }

  /** Users who hyped a post — Instagram-style "hyped by" list. */
  @Query(() => [PostHyperGql])
  async hypersByPost(
    @Args('postId', { type: () => ID }) postId: string,
    @Args('search', { type: () => String, nullable: true }) search?: string,
    @Args('skip', { type: () => Int, nullable: true }) skip?: number,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    return this.postsService.listHypers(postId, search, skip ?? 0, take);
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
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async pinPost(
    @CurrentUser() user: ReqUser,
    @Args('postId', { type: () => ID }) postId: string,
  ) {
    const post = await this.postsService.setPinned(postId, true);
    return this.postsService.toGql(post, user.id);
  }

  @Mutation(() => PostGql)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async unpinPost(
    @CurrentUser() user: ReqUser,
    @Args('postId', { type: () => ID }) postId: string,
  ) {
    const post = await this.postsService.setPinned(postId, false);
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

  @Mutation(() => PostGql)
  @UseGuards(GqlAuthGuard)
  async claimPostVotePrize(
    @CurrentUser() user: ReqUser,
    @Args('postId', { type: () => ID }) postId: string,
  ) {
    const post = await this.postsService.claimVotePrize(user.id, postId);
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
    // Only published posts are viewable via direct link. Unpublished
    // (scheduled/draft) posts — e.g. upcoming campaign match posts — return 404
    // to everyone except their author (so we don't leak that they exist yet).
    if (
      post.status !== PostStatus.PUBLISHED &&
      post.createdBy.toHexString() !== user?.id
    ) {
      throw new NotFoundException('Post not found');
    }
    // Friend posts are friends-only even via direct link — non-friends get a
    // 404 (not 403) so we don't leak that the post exists.
    if (!(await this.postsService.canViewPost(post, user?.id, user?.role))) {
      throw new NotFoundException('Post not found');
    }
    return this.postsService.toGql(post, user?.id);
  }

  @Query(() => [PostGql])
  @UseGuards(GqlAuthGuard)
  async myScheduledPosts(
    @CurrentUser() user: ReqUser,
    @Args('skip', { type: () => Int, nullable: true, defaultValue: 0 })
    skip?: number,
    @Args('take', { type: () => Int, nullable: true, defaultValue: 20 })
    take?: number,
  ) {
    const rows = await this.postsService.findScheduledByAuthor(
      user.id,
      skip ?? 0,
      take ?? 20,
    );
    return Promise.all(rows.map((p) => this.postsService.toGql(p, user.id)));
  }

  @Query(() => MyContentSummaryGql)
  @UseGuards(GqlAuthGuard)
  async myContentSummary(@CurrentUser() user: ReqUser) {
    return this.postsService.myContentSummary(user.id);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async cancelScheduledPost(
    @CurrentUser() user: ReqUser,
    @Args('postId', { type: () => ID }) postId: string,
  ) {
    return this.postsService.cancelScheduledPost(user.id, postId);
  }

  @Mutation(() => PostGql)
  @UseGuards(GqlAuthGuard)
  async updatePost(
    @CurrentUser() user: ReqUser,
    @Args('postId', { type: () => ID }) postId: string,
    @Args('input') input: UpdatePostInput,
  ) {
    const post = await this.postsService.updatePost(
      user.id,
      postId,
      input,
      user.role,
    );
    return this.postsService.toGql(post, user.id);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async deletePost(
    @CurrentUser() user: ReqUser,
    @Args('postId', { type: () => ID }) postId: string,
  ) {
    return this.postsService.deletePost(user.id, user.role, postId);
  }

  @Query(() => [PostGql])
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminPlatformPosts(
    @CurrentUser() user: ReqUser,
    @Args('query', { nullable: true }) query?: AdminPlatformPostsQueryInput,
    @Args('skip', { type: () => Int, nullable: true, defaultValue: 0 })
    skip?: number,
    @Args('take', { type: () => Int, nullable: true, defaultValue: 50 })
    take?: number,
  ) {
    const rows = await this.postsService.listPlatformPostsAdmin({
      search: query?.search,
      status: query?.status,
      categoryId: query?.categoryId,
      votingFilter: query?.votingFilter,
      scope: query?.scope,
      sortBy: query?.sortBy,
      sortOrder: query?.sortOrder,
      skip: query?.skip ?? skip ?? 0,
      take: query?.take ?? take ?? 50,
    });
    return Promise.all(rows.map((p) => this.postsService.toGql(p, user.id)));
  }

  @Query(() => Int)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminPlatformPostsCount(
    @Args('filter', { nullable: true }) filter?: AdminPlatformPostsFilterInput,
  ) {
    return this.postsService.countPlatformPostsAdmin({
      search: filter?.search,
      status: filter?.status,
      categoryId: filter?.categoryId,
      votingFilter: filter?.votingFilter,
      scope: filter?.scope,
    });
  }

  @Query(() => [PostGql])
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminReportedPosts(
    @CurrentUser() user: ReqUser,
    @Args('query', { nullable: true }) query?: AdminReportedPostsQueryInput,
    @Args('skip', { type: () => Int, nullable: true, defaultValue: 0 })
    skip?: number,
    @Args('take', { type: () => Int, nullable: true, defaultValue: 50 })
    take?: number,
  ) {
    const rows = await this.postsService.listReportedPostsAdmin({
      search: query?.search,
      minReportCount: query?.minReportCount,
      sortBy: query?.sortBy,
      sortOrder: query?.sortOrder,
      skip: query?.skip ?? skip ?? 0,
      take: query?.take ?? take ?? 50,
    });
    return Promise.all(rows.map((p) => this.postsService.toGql(p, user.id)));
  }

  @Query(() => Int)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminReportedPostsCount(
    @Args('filter', { nullable: true }) filter?: AdminReportedPostsFilterInput,
  ) {
    return this.postsService.countReportedPostsAdmin({
      search: filter?.search,
      minReportCount: filter?.minReportCount,
    });
  }

  @Query(() => [PostGql])
  @UseGuards(OptionalJwtGqlGuard)
  async getPostsByUser(
    @Args('userId', { type: () => ID }) userId: string,
    @Args('skip', { type: () => Int, nullable: true, defaultValue: 0 })
    skip?: number,
    @Args('take', { type: () => Int, nullable: true, defaultValue: 20 })
    take?: number,
    @CurrentUser() user?: ReqUser,
  ) {
    // Only return the author's posts this viewer is allowed to see — friend
    // posts stay hidden from non-friends on profile pages too.
    const rows = await this.postsService.findViewableByAuthor(
      userId,
      user?.id,
      user?.role,
      skip ?? 0,
      take ?? 20,
    );
    return Promise.all(rows.map((p) => this.postsService.toGql(p, user?.id)));
  }

  @Query(() => [PostGql])
  @UseGuards(GqlAuthGuard)
  async mySavedPosts(
    @CurrentUser() user: ReqUser,
    @Args('skip', { type: () => Int, nullable: true, defaultValue: 0 })
    skip?: number,
    @Args('take', { type: () => Int, nullable: true, defaultValue: 20 })
    take?: number,
  ) {
    const rows = await this.postsService.listSavedPosts(
      user.id,
      skip ?? 0,
      take ?? 20,
    );
    return Promise.all(rows.map((p) => this.postsService.toGql(p, user.id)));
  }

  @Query(() => [PostGql])
  @UseGuards(GqlAuthGuard)
  async myVotedPosts(
    @CurrentUser() user: ReqUser,
    @Args('anonymousOnly', { nullable: true }) anonymousOnly?: boolean,
    @Args('skip', { type: () => Int, nullable: true, defaultValue: 0 })
    skip?: number,
    @Args('take', { type: () => Int, nullable: true, defaultValue: 20 })
    take?: number,
  ) {
    const rows = await this.postsService.listVotedPosts(
      user.id,
      !!anonymousOnly,
      skip ?? 0,
      take ?? 20,
    );
    return Promise.all(rows.map((p) => this.postsService.toGql(p, user.id)));
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
      const post = await this.postsService.findById(
        payload.postVoteUpdated.postId,
      );
      if (!post) throw new NotFoundException('Post not found');
      return this.postsService.toGql(post, context.req?.user?.id);
    },
  })
  postVoteUpdated(@Args('postId', { type: () => ID }) postId: string) {
    void postId;
    return pubsub.asyncIterableIterator(POST_VOTE_UPDATED);
  }

  @Subscription(() => PostGql, {
    filter: (
      payload: { postUpdated: { postId: string } },
      variables: { postId: string },
    ) => payload.postUpdated.postId === variables.postId,
    resolve: async function (
      this: PostsResolver,
      payload: { postUpdated: { postId: string } },
      _variables: { postId: string },
      context: { req?: { user?: ReqUser } },
    ) {
      const post = await this.postsService.findById(payload.postUpdated.postId);
      if (!post) throw new NotFoundException('Post not found');
      return this.postsService.toGql(post, context.req?.user?.id);
    },
  })
  postUpdated(@Args('postId', { type: () => ID }) postId: string) {
    void postId;
    return pubsub.asyncIterableIterator(POST_UPDATED);
  }
}
