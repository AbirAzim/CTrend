import {
  Args,
  Field,
  ID,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { ForbiddenException, UseGuards } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { InvitationStatus, UserRole } from '../common/enums';
import { UsersService } from '../users/users.service';
import { UserGql } from '../users/graphql/user.types';

type ReqUser = { id: string; role: UserRole };

@ObjectType()
class InvitationGql {
  @Field(() => ID)
  id: string;

  @Field()
  email: string;

  @Field()
  role: string;

  @Field()
  status: string;

  @Field()
  expiresAt: Date;

  @Field()
  createdAt: Date;

  @Field(() => UserGql, { nullable: true })
  invitedBy?: UserGql | null;
}

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

  /** List all invitations — admin only. Optionally filter by status. */
  @Query(() => [InvitationGql])
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async listInvitations(
    @Args('status', { type: () => InvitationStatus, nullable: true })
    status?: InvitationStatus,
  ): Promise<InvitationGql[]> {
    const rows = await this.invitationsService.listAll(status);
    return Promise.all(
      rows.map(async (row) => {
        const inviter = row.invitedBy
          ? await this.usersService.findById(row.invitedBy.toHexString())
          : null;
        return {
          id: row._id.toHexString(),
          email: row.email,
          role: row.role,
          status: row.status,
          expiresAt: row.expiresAt,
          createdAt: (row as unknown as { createdAt: Date }).createdAt,
          invitedBy: inviter ? this.usersService.toGql(inviter) : null,
        };
      }),
    );
  }

  /** Cancel (delete) a pending invitation — admin only. */
  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async cancelInvitation(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    await this.invitationsService.cancel(id);
    return true;
  }

  /** Resend a pending invitation with a fresh token — admin only. */
  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async resendInvitation(
    @CurrentUser() user: ReqUser,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    if (user.role !== UserRole.ADMIN) throw new ForbiddenException();
    await this.invitationsService.resend(id);
    return true;
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
