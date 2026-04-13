import { ForbiddenException, UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { OrganizationsService } from './organizations.service';
import {
  OrganizationDashboardGql,
  OrganizationGql,
} from './graphql/org.types';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums';

type ReqUser = { id: string; role: UserRole };

@Resolver()
export class OrganizationsResolver {
  constructor(private organizationsService: OrganizationsService) {}

  @Mutation(() => OrganizationGql)
  @UseGuards(GqlAuthGuard)
  async createOrganization(
    @CurrentUser() user: ReqUser,
    @Args('name') name: string,
  ) {
    const org = await this.organizationsService.createOrganization(
      user.id,
      name,
    );
    return this.organizationsService.orgToGql(org);
  }

  @Query(() => OrganizationGql, { nullable: true })
  @UseGuards(GqlAuthGuard)
  async myOrganization(@CurrentUser() user: ReqUser) {
    if (user.role !== UserRole.ORG) return null;
    const org = await this.organizationsService.getOrgForUser(user.id);
    return org ? this.organizationsService.orgToGql(org) : null;
  }

  @Query(() => OrganizationDashboardGql)
  @UseGuards(GqlAuthGuard)
  async organizationDashboard(
    @CurrentUser() user: ReqUser,
    @Args('organizationId') organizationId: string,
  ) {
    if (user.role !== UserRole.ORG) {
      throw new ForbiddenException('Organization role required');
    }
    return this.organizationsService.dashboard(organizationId, user.id);
  }
}
