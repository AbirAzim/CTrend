import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { PlatformSettingsService } from './platform-settings.service';
import { PlatformSettingsGql } from './graphql/platform-settings.types';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { NotificationsService } from '../notifications/notifications.service';

@Resolver(() => PlatformSettingsGql)
export class PlatformSettingsResolver {
  constructor(
    private readonly platformSettingsService: PlatformSettingsService,
    private readonly notificationsService: NotificationsService,
  ) {}

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

  @Mutation(() => PlatformSettingsGql)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async setMinAndroidVersionCode(
    @Args('versionCode', { type: () => Int }) versionCode: number,
  ): Promise<PlatformSettingsGql> {
    return this.platformSettingsService.setMinAndroidVersionCode(versionCode);
  }

  /** Set min version + update message, then push/notify only outdated Android users. */
  @Mutation(() => Int)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async publishAndroidUpdateNotice(
    @Args('title') title: string,
    @Args('body') body: string,
    @Args('minVersionCode', { type: () => Int }) minVersionCode: number,
  ): Promise<number> {
    const settings = await this.platformSettingsService.publishAndroidUpdateNotice(
      title,
      body,
      minVersionCode,
    );
    return this.notificationsService.sendAndroidUpdateNotice(
      title.trim(),
      body.trim(),
      settings.minAndroidVersionCode,
    );
  }
}
