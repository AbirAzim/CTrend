import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { FollowsService } from './follows.service';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserGql } from '../users/graphql/user.types';
import { Field, ObjectType } from '@nestjs/graphql';

type ReqUser = { id: string };

@ObjectType()
class FriendRequestsGql {
  @Field(() => [UserGql])
  requestedByMe: UserGql[];

  @Field(() => [UserGql])
  requestedMe: UserGql[];
}

@Resolver()
export class FollowsResolver {
  constructor(private followsService: FollowsService) {}

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async followUser(
    @CurrentUser() user: ReqUser,
    @Args('userId', { type: () => ID }) userId: string,
  ) {
    await this.followsService.follow(user.id, userId);
    return true;
  }

  @Mutation(() => String)
  @UseGuards(GqlAuthGuard)
  async addFriend(
    @CurrentUser() user: ReqUser,
    @Args('userId', { type: () => ID }) userId: string,
  ) {
    return this.followsService.addFriendRequest(user.id, userId);
  }

  @Query(() => [UserGql])
  @UseGuards(GqlAuthGuard)
  async myFriends(@CurrentUser() user: ReqUser) {
    return this.followsService.getMyFriends(user.id);
  }

  @Query(() => [UserGql])
  @UseGuards(GqlAuthGuard)
  async friendSuggestions(
    @CurrentUser() user: ReqUser,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
  ) {
    return this.followsService.getFriendSuggestions(user.id, limit ?? 20);
  }

  @Query(() => [UserGql])
  @UseGuards(GqlAuthGuard)
  async incomingFriendRequests(@CurrentUser() user: ReqUser) {
    return this.followsService.getIncomingFriendRequests(user.id);
  }

  @Query(() => FriendRequestsGql)
  @UseGuards(GqlAuthGuard)
  async friendRequests(@CurrentUser() user: ReqUser) {
    const [requestedByMe, requestedMe] = await Promise.all([
      this.followsService.getOutgoingFriendRequests(user.id),
      this.followsService.getIncomingFriendRequests(user.id),
    ]);
    return { requestedByMe, requestedMe };
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async respondFriendRequest(
    @CurrentUser() user: ReqUser,
    @Args('requesterId', { type: () => ID }) requesterId: string,
    @Args('accept') accept: boolean,
  ) {
    await this.followsService.respondToFriendRequest(
      user.id,
      requesterId,
      accept,
    );
    return true;
  }
}
