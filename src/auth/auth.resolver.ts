import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { AuthService } from './auth.service';
import { RegisterInput } from './dto/auth.inputs';
import { AuthPayloadGql } from './graphql/auth.types';

@Resolver()
export class AuthResolver {
  constructor(private authService: AuthService) {}

  /** CTrend legacy: username + email + password + interests */
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
  login(
    @Args('email') email: string,
    @Args('password') password: string,
  ) {
    return this.authService.login(email, password);
  }

  @Mutation(() => AuthPayloadGql)
  signup(
    @Args('email') email: string,
    @Args('password') password: string,
    @Args('displayName', { nullable: true }) displayName?: string,
  ) {
    return this.authService.signup(email, password, displayName ?? undefined);
  }

  @Mutation(() => AuthPayloadGql)
  googleLogin(@Args('idToken') idToken: string) {
    return this.authService.googleLogin(idToken);
  }
}
