import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { PlatformSettingsService } from './platform-settings.service';
import { PlatformSettingsGql } from './graphql/platform-settings.types';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';

@Resolver(() => PlatformSettingsGql)
export class PlatformSettingsResolver {
  constructor(private readonly platformSettingsService: PlatformSettingsService) {}

  @Query(() => PlatformSettingsGql)
  async platformSettings(): Promise<PlatformSettingsGql> {
    return this.platformSettingsService.toGql();
  }

  @Mutation(() => PlatformSettingsGql)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async setAllowUserGlobalPosts(
    @Args('enabled') enabled: boolean,
  ): Promise<PlatformSettingsGql> {
    return this.platformSettingsService.setAllowUserGlobalPosts(enabled);
  }
}
