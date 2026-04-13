import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { FeedService } from './feed.service';
import { FeedConnectionGql } from './graphql/feed.types';
import { FeedScope, FeedSort } from '../common/enums';
import { OptionalJwtGqlGuard } from '../common/guards/optional-jwt-gql.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PostGql } from '../posts/graphql/post.types';

type ReqUser = { id: string };

@Resolver()
export class FeedResolver {
  constructor(private feedService: FeedService) {}

  @Query(() => FeedConnectionGql)
  @UseGuards(OptionalJwtGqlGuard)
  async getFeed(
    @Args('scope', { type: () => FeedScope }) scope: FeedScope,
    @Args('sort', { type: () => FeedSort }) sort: FeedSort,
    @Args('skip', { type: () => Int, nullable: true, defaultValue: 0 })
    skip: number,
    @Args('take', { type: () => Int, nullable: true, defaultValue: 20 })
    take: number,
    @CurrentUser() user?: ReqUser,
  ) {
    const viewerId = user?.id;
    return this.feedService.getFeed(scope, sort, skip, take, viewerId);
  }

  /**
   * Backward-compatible alias for frontend clients that query `feedPosts`.
   * Returns only the post list (equivalent to `getFeed(...).nodes`).
   */
  @Query(() => [PostGql])
  @UseGuards(OptionalJwtGqlGuard)
  async feedPosts(
    @Args('scope', { type: () => FeedScope, nullable: true })
    scope: FeedScope = FeedScope.GLOBAL,
    @Args('sort', { type: () => FeedSort, nullable: true })
    sort: FeedSort = FeedSort.LATEST,
    @Args('skip', { type: () => Int, nullable: true, defaultValue: 0 })
    skip: number,
    @Args('take', { type: () => Int, nullable: true, defaultValue: 20 })
    take: number,
    @CurrentUser() user?: ReqUser,
  ) {
    const viewerId = user?.id;
    const result = await this.feedService.getFeed(
      scope,
      sort,
      skip,
      take,
      viewerId,
    );
    return result.nodes;
  }
}
