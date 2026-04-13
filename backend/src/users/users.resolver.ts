import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { UserGql } from './graphql/user.types';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpdateProfileInput } from './dto/update-profile.input';
import { NotFoundException } from '@nestjs/common';

type ReqUser = {
  id: string;
  role: string;
  email: string;
  username: string;
  interests: string[];
};

@Resolver(() => UserGql)
export class UsersResolver {
  constructor(private usersService: UsersService) {}

  @Query(() => UserGql)
  @UseGuards(GqlAuthGuard)
  me(@CurrentUser() user: ReqUser) {
    return this.usersService.findById(user.id).then((u) => {
      if (!u) throw new NotFoundException();
      return this.usersService.toGql(u);
    });
  }

  @Query(() => UserGql)
  async getUserProfile(@Args('userId', { type: () => ID }) userId: string) {
    const u = await this.usersService.findById(userId);
    if (!u) throw new NotFoundException('User not found');
    return this.usersService.toGql(u);
  }

  @Mutation(() => UserGql)
  @UseGuards(GqlAuthGuard)
  async updateProfile(
    @CurrentUser() user: ReqUser,
    @Args('input') input: UpdateProfileInput,
  ) {
    const u = await this.usersService.updateProfile(user.id, input);
    if (!u) throw new NotFoundException();
    return this.usersService.toGql(u);
  }
}
