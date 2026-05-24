import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums';

type ReqUser = { id: string; role: UserRole };

@Resolver()
export class InvitationsResolver {
  constructor(private invitationsService: InvitationsService) {}

  /** Any authenticated user can invite others as regular users. */
  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  inviteUser(
    @CurrentUser() user: ReqUser,
    @Args('email') email: string,
  ) {
    return this.invitationsService.invite(user.id, user.role, email, UserRole.USER);
  }

  /** Only admins can invite other admins. */
  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  inviteAdmin(
    @CurrentUser() user: ReqUser,
    @Args('email') email: string,
  ) {
    return this.invitationsService.invite(user.id, user.role, email, UserRole.ADMIN);
  }
}
