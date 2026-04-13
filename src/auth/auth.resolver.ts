import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { AuthService } from './auth.service';
import { RegisterInput, LoginInput } from './dto/auth.inputs';
import { AuthPayloadGql } from './graphql/auth.types';

@Resolver()
export class AuthResolver {
  constructor(private authService: AuthService) {}

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
  login(@Args('input') input: LoginInput) {
    return this.authService.login(input.email, input.password);
  }
}
