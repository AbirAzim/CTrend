import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Int } from '@nestjs/graphql';
import { WorldCupCampaignService } from './world-cup-campaign.service';
import {
  CampaignWinnerGql,
  CampaignWinLeaderboardEntryGql,
  UserCampaignWinSummaryGql,
} from './graphql/campaign-winner.types';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';

@Resolver(() => CampaignWinnerGql)
export class WorldCupCampaignResolver {
  constructor(private campaignService: WorldCupCampaignService) {}

  @Query(() => CampaignWinnerGql, { nullable: true })
  async campaignWinner(
    @Args('fixtureId', { type: () => ID }) fixtureId: string,
  ): Promise<CampaignWinnerGql | null> {
    return this.campaignService.findByFixture(fixtureId);
  }

  @Query(() => [CampaignWinnerGql])
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async campaignWinners(): Promise<CampaignWinnerGql[]> {
    return this.campaignService.findAll();
  }

  /** Public — users ranked by most campaign wins (campaign leaderboard). */
  @Query(() => [CampaignWinLeaderboardEntryGql])
  async campaignWinLeaderboard(
    @Args('campaignId', { type: () => ID, nullable: true }) campaignId?: string,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ): Promise<CampaignWinLeaderboardEntryGql[]> {
    return this.campaignService.winLeaderboard(campaignId, take ?? 50);
  }

  /** Public — per-campaign win totals for a user's profile. */
  @Query(() => [UserCampaignWinSummaryGql])
  async userCampaignWinSummary(
    @Args('userId', { type: () => ID }) userId: string,
  ): Promise<UserCampaignWinSummaryGql[]> {
    return this.campaignService.userCampaignWinSummary(userId);
  }

  @Mutation(() => CampaignWinnerGql)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async processMatchResult(
    @Args('fixtureId', { type: () => ID }) fixtureId: string,
    @Args('campaignId', { type: () => ID, nullable: true }) campaignId?: string,
  ): Promise<CampaignWinnerGql> {
    return this.campaignService.processMatchResult(fixtureId, campaignId);
  }

  @Mutation(() => CampaignWinnerGql)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async markCampaignPrizePaid(
    @Args('winnerId', { type: () => ID }) winnerId: string,
  ): Promise<CampaignWinnerGql> {
    return this.campaignService.markPaid(winnerId);
  }
}
