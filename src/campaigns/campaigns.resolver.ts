import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import {
  CampaignGql,
  CreateCampaignInput,
  UpdateCampaignInput,
} from './graphql/campaign.types';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';

@Resolver(() => CampaignGql)
export class CampaignsResolver {
  constructor(private campaignsService: CampaignsService) {}

  /** Public — single campaign detail page by slug */
  @Query(() => CampaignGql, { nullable: true })
  async campaign(
    @Args('slug') slug: string,
  ): Promise<CampaignGql | null> {
    const doc = await this.campaignsService.findBySlug(slug);
    return doc ? this.campaignsService.toGql(doc) : null;
  }

  /** Public — used by frontend to show promotional banners */
  @Query(() => [CampaignGql])
  async activeCampaigns(): Promise<CampaignGql[]> {
    const docs = await this.campaignsService.findActive();
    return docs.map((d) => this.campaignsService.toGql(d));
  }

  @Query(() => [CampaignGql])
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async campaigns(): Promise<CampaignGql[]> {
    const docs = await this.campaignsService.findAll();
    return docs.map((d) => this.campaignsService.toGql(d));
  }

  @Mutation(() => CampaignGql)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async createCampaign(
    @Args('input') input: CreateCampaignInput,
  ): Promise<CampaignGql> {
    const doc = await this.campaignsService.create(input);
    return this.campaignsService.toGql(doc);
  }

  @Mutation(() => CampaignGql)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async updateCampaign(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateCampaignInput,
  ): Promise<CampaignGql> {
    const doc = await this.campaignsService.update(id, input);
    return this.campaignsService.toGql(doc);
  }

  @Mutation(() => CampaignGql)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async toggleCampaign(
    @Args('id', { type: () => ID }) id: string,
    @Args('isActive') isActive: boolean,
  ): Promise<CampaignGql> {
    const doc = await this.campaignsService.toggle(id, isActive);
    return this.campaignsService.toGql(doc);
  }
}
