import { Args, Field, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums';
import { UsersService } from '../users/users.service';
import { UserGql } from '../users/graphql/user.types';

type ReqUser = { id: string; role: UserRole };

@ObjectType()
class InvitePreviewGql {
  @Field()
  email: string;

  @Field(() => UserGql, { nullable: true })
  existingUser?: UserGql | null;

  @Field()
  hasPendingInvite: boolean;
}

@ObjectType()
class InviteResultGql {
  @Field()
  email: string;

  @Field()
  status: string; // 'invited' | 'already_exists' | 'already_invited' | 'error'

  @Field({ nullable: true })
  message?: string;
}

@Resolver()
export class InvitationsResolver {
  constructor(
    private invitationsService: InvitationsService,
    private usersService: UsersService,
  ) {}

  /** Any authenticated user can invite others as regular users. */
  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  inviteUser(@CurrentUser() user: ReqUser, @Args('email') email: string) {
    return this.invitationsService.invite(
      user.id,
      user.role,
      email,
      UserRole.USER,
    );
  }

  /** Only admins can invite other admins. */
  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  inviteAdmin(@CurrentUser() user: ReqUser, @Args('email') email: string) {
    return this.invitationsService.invite(
      user.id,
      user.role,
      email,
      UserRole.ADMIN,
    );
  }

  /** Bulk invite: send user invitations to multiple emails in one call. */
  @Mutation(() => [InviteResultGql])
  @UseGuards(GqlAuthGuard)
  async inviteUsers(
    @CurrentUser() user: ReqUser,
    @Args('emails', { type: () => [String] }) emails: string[],
  ): Promise<InviteResultGql[]> {
    const results: InviteResultGql[] = [];
    for (const email of emails) {
      try {
        await this.invitationsService.invite(
          user.id,
          user.role,
          email.trim(),
          UserRole.USER,
        );
        results.push({ email, status: 'invited' });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('already exists') || msg.includes('already registered')) {
          results.push({ email, status: 'already_exists', message: msg });
        } else {
          results.push({ email, status: 'error', message: msg });
        }
      }
    }
    return results;
  }

  /** Preview a list of emails: returns existing CTrend users and pending-invite status. */
  @Query(() => [InvitePreviewGql])
  @UseGuards(GqlAuthGuard)
  async previewInvites(
    @Args('emails', { type: () => [String] }) emails: string[],
  ): Promise<InvitePreviewGql[]> {
    const clean = [...new Set(emails.map((e) => e.trim().toLowerCase()))].filter(Boolean);
    if (!clean.length) return [];

    const existingUsers = await this.usersService.findByEmails(clean);
    const existingMap = new Map(existingUsers.map((u) => [u.email, u]));

    return Promise.all(
      clean.map(async (email) => {
        const found = existingMap.get(email) ?? null;
        const hasPendingInvite = found
          ? false
          : await this.invitationsService.isPendingFor(email);
        return {
          email,
          existingUser: found ? this.usersService.toGql(found) : null,
          hasPendingInvite,
        };
      }),
    );
  }
}
