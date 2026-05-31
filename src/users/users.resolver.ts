import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  ForbiddenException,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';
import { UserGql } from './graphql/user.types';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpdateProfileInput } from './dto/update-profile.input';
import { normalizeListUsersQuery } from './dto/list-users.input';
import { UserRole } from '../common/enums';
import { PromotionTokensService } from '../promotion-tokens/promotion-tokens.service';

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
    private promotionTokensService: PromotionTokensService,
  ) {}

  @Query(() => UserGql)
  @UseGuards(GqlAuthGuard)
  me(@CurrentUser() user: ReqUser) {
    return this.usersService.findById(user.id).then((u) => {
      if (!u) throw new NotFoundException();
      // Pass the activeRole from the JWT so `role` reflects the current session mode.
      return this.usersService.toGql(u, user.role as UserRole);
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

  /** Admin: list all platform users, optionally filtered by role. */
  @Query(() => [UserGql])
  @UseGuards(GqlAuthGuard)
  async listUsers(
    @CurrentUser() actor: ReqUser,
    @Args('skip', { type: () => Int, defaultValue: 0 }) skip: number,
    @Args('take', { type: () => Int, defaultValue: 50 }) take: number,
    @Args('role', { type: () => String, nullable: true }) role?: string,
    @Args('search', { type: () => String, nullable: true }) search?: string,
    @Args('searchBy', { type: () => String, nullable: true }) searchBy?: string,
    @Args('status', { type: () => String, nullable: true }) status?: string,
    @Args('sortBy', { type: () => String, nullable: true }) sortBy?: string,
    @Args('sortOrder', { type: () => String, nullable: true }) sortOrder?: string,
  ): Promise<UserGql[]> {
    if (actor.role !== UserRole.ADMIN)
      throw new ForbiddenException('Admin only');
    const roleFilter = role ? (role as UserRole) : undefined;
    const query = {
      role: roleFilter,
      ...normalizeListUsersQuery({ search, searchBy, status, sortBy, sortOrder }),
    };
    const users = await this.usersService.listUsers(
      skip,
      Math.min(take, 200),
      query,
    );
    return users.map((u) => this.usersService.toGql(u));
  }

  /** Admin: total count of users matching the role filter (for pagination). */
  @Query(() => Int)
  @UseGuards(GqlAuthGuard)
  async listUsersCount(
    @CurrentUser() actor: ReqUser,
    @Args('role', { type: () => String, nullable: true }) role?: string,
    @Args('search', { type: () => String, nullable: true }) search?: string,
    @Args('searchBy', { type: () => String, nullable: true }) searchBy?: string,
    @Args('status', { type: () => String, nullable: true }) status?: string,
  ): Promise<number> {
    if (actor.role !== UserRole.ADMIN)
      throw new ForbiddenException('Admin only');
    const roleFilter = role ? (role as UserRole) : undefined;
    const query = {
      role: roleFilter,
      ...normalizeListUsersQuery({ search, searchBy, status }),
    };
    return this.usersService.listUsersCount(query);
  }

  /** Admin: promote an existing user to also hold the admin role. */
  @Mutation(() => UserGql)
  @UseGuards(GqlAuthGuard)
  async promoteToAdmin(
    @CurrentUser() actor: ReqUser,
    @Args('email') email: string,
  ): Promise<UserGql> {
    if (actor.role !== UserRole.ADMIN)
      throw new ForbiddenException('Admin only');
    const target = await this.usersService.findByEmail(email);
    if (!target) throw new NotFoundException('User not found');
    const updated = await this.usersService.promoteToAdmin(email);
    if (!updated) throw new NotFoundException('User not found');
    // Send notification email with rejection link + record in invitations for audit trail
    await this.promotionTokensService.createAndSend(
      updated._id.toHexString(),
      actor.id,
    );
    await this.promotionTokensService.recordPromotion(actor.id, updated.email);
    return this.usersService.toGql(updated);
  }

  /** Anyone with a valid promotion token can reject (decline) their admin promotion. */
  @Mutation(() => Boolean)
  async rejectAdminPromotion(@Args('token') token: string): Promise<boolean> {
    await this.promotionTokensService.reject(token);
    return true;
  }

  /** Admin: remove a regular user by email. Fails if the target holds an admin role. */
  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async removeUser(
    @CurrentUser() actor: ReqUser,
    @Args('email') email: string,
  ): Promise<boolean> {
    if (actor.role !== UserRole.ADMIN)
      throw new ForbiddenException('Admin only');
    const target = await this.usersService.findByEmail(email);
    if (!target) throw new NotFoundException('User not found');
    const roles = this.usersService.resolveRoles(target);
    if (roles.includes(UserRole.ADMIN)) {
      throw new ForbiddenException(
        'Use removeAdmin to revoke admin access first',
      );
    }
    return this.usersService.removeByEmail(email);
  }

  /**
   * Admin: revoke admin role from a user (demote — account is kept with user role).
   * Cannot target the system admin.
   */
  @Mutation(() => UserGql)
  @UseGuards(GqlAuthGuard)
  async removeAdmin(
    @CurrentUser() actor: ReqUser,
    @Args('email') email: string,
  ): Promise<UserGql> {
    if (actor.role !== UserRole.ADMIN)
      throw new ForbiddenException('Admin only');
    const sysAdminEmail = this.config.get<string>('SYSTEM_ADMIN_EMAIL', '');
    if (email.trim().toLowerCase() === sysAdminEmail.toLowerCase()) {
      throw new ForbiddenException(
        'The system admin account cannot be modified',
      );
    }
    const target = await this.usersService.findByEmail(email);
    if (!target) throw new NotFoundException('User not found');
    const roles = this.usersService.resolveRoles(target);
    if (!roles.includes(UserRole.ADMIN)) {
      throw new ForbiddenException('Target does not have admin role');
    }
    const updated = await this.usersService.demoteFromAdmin(email);
    if (!updated) throw new NotFoundException('User not found');
    return this.usersService.toGql(updated);
  }
}
