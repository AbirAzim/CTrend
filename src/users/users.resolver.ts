import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ForbiddenException, NotFoundException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';
import { UserGql } from './graphql/user.types';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpdateProfileInput } from './dto/update-profile.input';
import { UserRole } from '../common/enums';

type ReqUser = {
  id: string;
  role: UserRole;
  email: string;
  username: string;
  interests: string[];
};

@Resolver(() => UserGql)
export class UsersResolver {
  constructor(
    private usersService: UsersService,
    private config: ConfigService,
  ) {}

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

  /** Admin: list all platform users. */
  @Query(() => [UserGql])
  @UseGuards(GqlAuthGuard)
  async listUsers(
    @CurrentUser() actor: ReqUser,
    @Args('skip', { type: () => Int, defaultValue: 0 }) skip: number,
    @Args('take', { type: () => Int, defaultValue: 50 }) take: number,
  ): Promise<UserGql[]> {
    if (actor.role !== UserRole.ADMIN) throw new ForbiddenException('Admin only');
    const users = await this.usersService.listUsers(skip, Math.min(take, 200));
    return users.map((u) => this.usersService.toGql(u));
  }

  /** Admin: remove a regular user by email. Cannot remove admins or the system admin. */
  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async removeUser(
    @CurrentUser() actor: ReqUser,
    @Args('email') email: string,
  ): Promise<boolean> {
    if (actor.role !== UserRole.ADMIN) throw new ForbiddenException('Admin only');
    const target = await this.usersService.findByEmail(email);
    if (!target) throw new NotFoundException('User not found');
    if (target.role === UserRole.ADMIN) {
      throw new ForbiddenException('Use removeAdmin to remove admin users');
    }
    return this.usersService.removeByEmail(email);
  }

  /** Admin: remove another admin by email. Cannot remove the system admin. */
  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async removeAdmin(
    @CurrentUser() actor: ReqUser,
    @Args('email') email: string,
  ): Promise<boolean> {
    if (actor.role !== UserRole.ADMIN) throw new ForbiddenException('Admin only');
    const sysAdminEmail = this.config.get<string>('SYSTEM_ADMIN_EMAIL', '');
    if (email.trim().toLowerCase() === sysAdminEmail.toLowerCase()) {
      throw new ForbiddenException('The system admin account cannot be removed');
    }
    const target = await this.usersService.findByEmail(email);
    if (!target) throw new NotFoundException('User not found');
    if (target.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Target is not an admin');
    }
    return this.usersService.removeByEmail(email);
  }
}
