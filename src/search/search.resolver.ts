import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchResultGql } from './graphql/search.types';
import { OptionalJwtGqlGuard } from '../common/guards/optional-jwt-gql.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

type ReqUser = { id: string };

@Resolver()
export class SearchResolver {
  constructor(private searchService: SearchService) {}

  /**
   * Global search across users (friends prioritized) and posts (caption +
   * option labels). Authenticated viewer gets friend-priority ranking.
   */
  @Query(() => SearchResultGql)
  @UseGuards(OptionalJwtGqlGuard)
  async globalSearch(
    @Args('query') query: string,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 20 })
    limit: number,
    @CurrentUser() user?: ReqUser,
  ): Promise<SearchResultGql> {
    return this.searchService.globalSearch(user?.id, query, limit ?? 20);
  }
}
