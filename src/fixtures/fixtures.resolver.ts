import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { FixturesService } from './fixtures.service';
import { FixtureGql, FixtureFilterInput } from './graphql/fixture.types';
import { PostGql } from '../posts/graphql/post.types';
import { PostsService } from '../posts/posts.service';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums';

type ReqUser = { id: string };

@Resolver(() => FixtureGql)
export class FixturesResolver {
  constructor(
    private fixturesService: FixturesService,
    private postsService: PostsService,
  ) {}

  @Query(() => [FixtureGql])
  async worldCupFixtures(
    @Args('filter', { nullable: true }) filter?: FixtureFilterInput,
  ): Promise<FixtureGql[]> {
    const docs = await this.fixturesService.findAll(filter);
    return docs.map((d) => this.fixturesService.toGql(d));
  }

  @Query(() => FixtureGql, { nullable: true })
  async worldCupFixture(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<FixtureGql | null> {
    const doc = await this.fixturesService.findById(id);
    return doc ? this.fixturesService.toGql(doc) : null;
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async syncWorldCupFixtures(): Promise<boolean> {
    const count = await this.fixturesService.syncFixtures();
    return count > 0;
  }

  @Mutation(() => PostGql)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async createWorldCupCampaignPost(
    @CurrentUser() user: ReqUser,
    @Args('fixtureId', { type: () => ID }) fixtureId: string,
  ): Promise<PostGql> {
    const post = await this.fixturesService.createCampaignPost(
      fixtureId,
      user.id,
    );
    return this.postsService.toGql(post, user.id);
  }
}
