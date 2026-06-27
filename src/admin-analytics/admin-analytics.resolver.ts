import { Query, Resolver } from '@nestjs/graphql';
import { ForbiddenException, UseGuards } from '@nestjs/common';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminPlatformStatsGql } from './graphql/admin-analytics.types';
import { UserGql } from '../users/graphql/user.types';

@Resolver()
export class AdminAnalyticsResolver {
  constructor(private adminAnalyticsService: AdminAnalyticsService) {}

  @Query(() => AdminPlatformStatsGql)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminPlatformStats(): Promise<AdminPlatformStatsGql> {
    return this.adminAnalyticsService.getPlatformStats();
  }

  @Query(() => [UserGql])
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminOnlineUsers(): Promise<UserGql[]> {
    return this.adminAnalyticsService.getOnlineUsers();
  }
}
