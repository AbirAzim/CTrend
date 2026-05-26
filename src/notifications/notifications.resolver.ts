import {
  Args,
  ID,
  Int,
  Mutation,
  Query,
  Resolver,
  Subscription,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import {
  NotificationGql,
  NotificationsPageGql,
} from './graphql/notification.types';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums';
import { pubsub, NEW_NOTIFICATION } from '../pubsub';

type ReqUser = { id: string };

@Resolver()
export class NotificationsResolver {
  constructor(private notificationsService: NotificationsService) {}

  @Query(() => NotificationsPageGql)
  @UseGuards(GqlAuthGuard)
  async myNotifications(
    @CurrentUser() user: ReqUser,
    @Args('skip', { type: () => Int, defaultValue: 0 }) skip: number,
    @Args('take', { type: () => Int, defaultValue: 20 }) take: number,
  ) {
    return this.notificationsService.myNotifications(user.id, skip, take);
  }

  @Query(() => Int)
  @UseGuards(GqlAuthGuard)
  async unreadNotificationCount(@CurrentUser() user: ReqUser): Promise<number> {
    return this.notificationsService.unreadCount(user.id);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async markNotificationRead(
    @CurrentUser() user: ReqUser,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.notificationsService.markRead(user.id, id);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async markAllNotificationsRead(@CurrentUser() user: ReqUser) {
    return this.notificationsService.markAllRead(user.id);
  }

  @Mutation(() => Int)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async sendAdminBroadcast(
    @CurrentUser() user: ReqUser,
    @Args('title') title: string,
    @Args('body') body: string,
  ): Promise<number> {
    return this.notificationsService.sendBroadcast(user.id, title, body);
  }

  @Subscription(() => NotificationGql, {
    filter(payload, _variables, context) {
      const userId: string = context?.req?.user?.id;
      return userId === payload.recipientId;
    },
    resolve: (payload) => payload.newNotification,
  })
  @UseGuards(GqlAuthGuard)
  newNotification() {
    return pubsub.asyncIterableIterator(NEW_NOTIFICATION);
  }
}
