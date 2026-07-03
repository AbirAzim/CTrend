import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { FixturesService } from './fixtures.service';
import {
  FixtureGql,
  FixtureFilterInput,
  FixtureDetailsSyncResultGql,
  TopScorerGql,
  TopAssistantGql,
} from './graphql/fixture.types';
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

  @Query(() => [TopScorerGql])
  async worldCupTopScorers(): Promise<TopScorerGql[]> {
    return this.fixturesService.getTopScorers();
  }

  @Query(() => [TopAssistantGql])
  async worldCupTopAssistants(): Promise<TopAssistantGql[]> {
    return this.fixturesService.getTopAssistants();
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

  @Mutation(() => String)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async syncLiveNow(): Promise<string> {
    const count = await this.fixturesService.syncLiveScores();
    return `Live sync ran — ${count} fixture(s) refreshed`;
  }

  @Mutation(() => FixtureDetailsSyncResultGql)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async syncFixtureDetails(
    @Args('fixtureId', { type: () => ID }) fixtureId: string,
  ): Promise<FixtureDetailsSyncResultGql> {
    const doc = await this.fixturesService.findById(fixtureId);
    if (!doc)
      return { events: 0, stats: 0, lineups: 0, error: 'Fixture not found' };
    return this.fixturesService.syncMatchDetails(doc, true);
  }

  @Mutation(() => String)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async syncAllFinishedFixtures(): Promise<string> {
    const result = await this.fixturesService.syncAllFinishedFixtures();
    return `Done — synced: ${result.synced}, already had data: ${result.skipped}, errors: ${result.errors}`;
  }

  @Mutation(() => String)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async sendFixtureLineupNotification(
    @Args('fixtureId', { type: () => ID }) fixtureId: string,
  ): Promise<string> {
    const result = await this.fixturesService.sendLineupNotification(fixtureId);
    if (result.error) return `Error: ${result.error}`;
    return `Lineup notification sent to ${result.sent} users`;
  }

  @Mutation(() => String)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async reconcileLiveMatchPosts(): Promise<string> {
    const count = await this.fixturesService.reconcileLivePosts();
    return `Live post reconcile complete — ${count} post(s) refreshed`;
  }

  @Mutation(() => String)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async reconcileFinishedMatchPosts(): Promise<string> {
    await this.fixturesService.reconcileFinishedPosts();
    return 'Reconciliation complete — check winner announcement cron in ~60s';
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
