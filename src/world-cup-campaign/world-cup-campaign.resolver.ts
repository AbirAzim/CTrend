import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { WorldCupCampaignService } from './world-cup-campaign.service';
import { CampaignWinnerGql } from './graphql/campaign-winner.types';
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
