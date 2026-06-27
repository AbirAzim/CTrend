import { Query, Resolver } from '@nestjs/graphql';
import { ForbiddenException, UseGuards } from '@nestjs/common';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminPlatformStatsGql } from './graphql/admin-analytics.types';

@Resolver()
export class AdminAnalyticsResolver {
  constructor(private adminAnalyticsService: AdminAnalyticsService) {}

  @Query(() => AdminPlatformStatsGql)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminPlatformStats(): Promise<AdminPlatformStatsGql> {
    return this.adminAnalyticsService.getPlatformStats();
  }
}
