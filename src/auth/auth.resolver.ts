import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterInput } from './dto/auth.inputs';
import { AuthPayloadGql } from './graphql/auth.types';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums';

type ReqUser = { id: string };

@Resolver()
export class AuthResolver {
  constructor(private authService: AuthService) {}

  /** CTrend legacy: username + email + password + interests — returns tokens immediately. */
  @Mutation(() => AuthPayloadGql)
  register(@Args('input') input: RegisterInput) {
    return this.authService.register(
      input.username,
      input.email,
      input.password,
      input.interests,
    );
  }

  @Mutation(() => AuthPayloadGql)
  login(@Args('email') email: string, @Args('password') password: string) {
    return this.authService.login(email, password);
  }

  /**
   * Creates a pending account and emails a 6-digit OTP.
   * Call verifyEmail() with the code to get tokens.
   */
  @Mutation(() => Boolean)
  signup(
    @Args('email') email: string,
    @Args('password') password: string,
    @Args('displayName', { nullable: true }) displayName?: string,
  ) {
    return this.authService.signup(email, password, displayName ?? undefined);
  }

  @Mutation(() => AuthPayloadGql)
  verifyEmail(
    @Args('email') email: string,
    @Args('code') code: string,
    @Args('referralCode', { nullable: true }) referralCode?: string,
  ) {
    return this.authService.verifyEmail(email, code, referralCode ?? undefined);
  }

  @Mutation(() => Boolean)
  resendVerificationEmail(@Args('email') email: string) {
    return this.authService.resendVerificationEmail(email);
  }

  @Mutation(() => Boolean)
  requestPasswordReset(@Args('email') email: string) {
    return this.authService.requestPasswordReset(email);
  }

  @Mutation(() => Boolean)
  resetPassword(
    @Args('token') token: string,
    @Args('newPassword') newPassword: string,
  ) {
    return this.authService.resetPassword(token, newPassword);
  }

  @Mutation(() => AuthPayloadGql)
  googleLogin(@Args('idToken') idToken: string) {
    return this.authService.googleLogin(idToken);
  }

  /** Accept an email invitation and create an account. Returns tokens immediately. */
  @Mutation(() => AuthPayloadGql)
  acceptInvitation(
    @Args('token') token: string,
    @Args('password') password: string,
    @Args('displayName', { nullable: true }) displayName?: string,
  ) {
    return this.authService.acceptInvitation(
      token,
      password,
      displayName ?? undefined,
    );
  }

  /**
   * Switch the active role for this session.
   * Returns a new JWT with the chosen role embedded.
   * Only valid if the authenticated user actually holds that role.
   */
  @Mutation(() => AuthPayloadGql)
  @UseGuards(GqlAuthGuard)
  switchActiveRole(
    @CurrentUser() user: ReqUser,
    @Args('role', { type: () => UserRole }) role: UserRole,
  ) {
    return this.authService.switchActiveRole(user.id, role);
  }
}
