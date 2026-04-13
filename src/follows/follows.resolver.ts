import { Args, ID, Mutation, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { FollowsService } from './follows.service';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

type ReqUser = { id: string };

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
}
