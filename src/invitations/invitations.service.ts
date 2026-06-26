import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { createHash, randomBytes } from 'crypto';
import { Invitation, InvitationDocument } from './invitation.schema';
import { InvitationStatus, UserRole } from '../common/enums';
import { resolveFrontendUrl } from '../common/frontend-url';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { CoinsService } from '../coins/coins.service';
import { CoinType } from '../coins/coins.constants';
import { NotificationsService } from '../notifications/notifications.service';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REFERRAL_CODE_LEN = 8;
const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type RedeemReferralResult = {
  inviteeCoins: number;
  inviterCoins: number;
  balance: number;
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function generateReferralCode(): string {
  const bytes = randomBytes(REFERRAL_CODE_LEN);
  let out = '';
  for (let i = 0; i < REFERRAL_CODE_LEN; i++) {
    out += REFERRAL_ALPHABET[bytes[i]! % REFERRAL_ALPHABET.length];
  }
  return out;
}

@Injectable()
export class InvitationsService {
  constructor(
    @InjectModel(Invitation.name)
    private invitationModel: Model<InvitationDocument>,
    private usersService: UsersService,
    private mailService: MailService,
    private config: ConfigService,
    private coinsService: CoinsService,
    private notificationsService: NotificationsService,
  ) {}

  private async uniqueReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = generateReferralCode();
      const exists = await this.invitationModel.exists({ referralCode: code });
      if (!exists) return code;
    }
    throw new BadRequestException('Could not generate referral code — try again');
  }

  async invite(
    inviterId: string,
    inviterRole: UserRole,
    email: string,
    targetRole: UserRole,
  ): Promise<boolean> {
    if (targetRole === UserRole.ADMIN && inviterRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can invite other admins');
    }

    const normalized = email.trim().toLowerCase();
    const existing = await this.usersService.findByEmail(normalized);
    if (existing) {
      if (targetRole === UserRole.ADMIN) {
        throw new ConflictException(
          'This user already has an account. Use promoteToAdmin to grant them admin access.',
        );
      }
      throw new ConflictException('A user with this email already exists');
    }

    // Cancel any existing pending invitation for this email to avoid duplicates.
    await this.invitationModel.deleteMany({
      email: normalized,
      status: InvitationStatus.PENDING,
    });

    const rawToken = randomBytes(32).toString('hex');
    const referralCode = await this.uniqueReferralCode();
    await this.invitationModel.create({
      tokenHash: sha256(rawToken),
      referralCode,
      email: normalized,
      invitedBy: new Types.ObjectId(inviterId),
      role: targetRole,
      status: InvitationStatus.PENDING,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });

    const inviter = await this.usersService.findById(inviterId);
    const inviterName =
      inviter?.displayName ?? inviter?.username ?? 'A CTrend user';
    const frontend = resolveFrontendUrl(this.config);
    const inviteUrl = this.buildInviteUrl(
      frontend,
      targetRole,
      normalized,
      referralCode,
      rawToken,
    );
    await this.mailService.sendInvitationEmail(
      normalized,
      inviteUrl,
      inviterName,
      referralCode,
    );

    return true;
  }

  async isPendingFor(email: string): Promise<boolean> {
    const n = await this.invitationModel.countDocuments({
      email: email.trim().toLowerCase(),
      status: InvitationStatus.PENDING,
      expiresAt: { $gt: new Date() },
    });
    return n > 0;
  }

  async findByRawToken(rawToken: string): Promise<InvitationDocument | null> {
    return this.invitationModel.findOne({
      tokenHash: sha256(rawToken),
      status: InvitationStatus.PENDING,
      expiresAt: { $gt: new Date() },
    });
  }

  async findByReferralCode(rawCode: string): Promise<InvitationDocument | null> {
    const code = rawCode.trim().toUpperCase();
    if (!code) return null;
    return this.invitationModel.findOne({
      referralCode: code,
      status: InvitationStatus.PENDING,
      expiresAt: { $gt: new Date() },
    });
  }

  /**
   * Redeem a referral code for the authenticated user.
   * Security: email must match invitation, one-time only, invitee cannot be inviter.
   */
  async redeemReferralCode(
    rawCode: string,
    userId: string,
  ): Promise<RedeemReferralResult> {
    const code = rawCode.trim().toUpperCase();
    if (!code) {
      throw new BadRequestException('Referral code is required');
    }

    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.emailVerified) {
      throw new BadRequestException('Verify your email before redeeming a code');
    }

    const invitation = await this.findByReferralCode(code);
    if (!invitation) {
      throw new BadRequestException('Invalid or expired referral code');
    }

    const userEmail = user.email.trim().toLowerCase();
    if (userEmail !== invitation.email) {
      throw new ForbiddenException(
        'This referral code was sent to a different email address',
      );
    }

    if (invitation.invitedBy.toHexString() === userId) {
      throw new BadRequestException('You cannot redeem your own invitation code');
    }

    return this.fulfillInvitation(invitation, userId);
  }

  /** Mark invitation accepted and award coins to invitee + inviter (idempotent ledger). */
  async markAccepted(
    invitationId: string,
    inviteeUserId: string,
  ): Promise<RedeemReferralResult> {
    const invitation = await this.invitationModel.findById(invitationId).exec();
    if (!invitation) {
      return { inviteeCoins: 0, inviterCoins: 0, balance: 0 };
    }
    if (invitation.status === InvitationStatus.ACCEPTED) {
      const balance = await this.coinsService.getBalance(inviteeUserId);
      return { inviteeCoins: 0, inviterCoins: 0, balance };
    }
    return this.fulfillInvitation(invitation, inviteeUserId);
  }

  private async fulfillInvitation(
    invitation: InvitationDocument,
    inviteeUserId: string,
  ): Promise<RedeemReferralResult> {
    const invitationId = invitation._id.toHexString();
    const updated = await this.invitationModel
      .findOneAndUpdate(
        { _id: invitation._id, status: InvitationStatus.PENDING },
        {
          status: InvitationStatus.ACCEPTED,
          redeemedByUserId: new Types.ObjectId(inviteeUserId),
          redeemedAt: new Date(),
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new BadRequestException('This invitation has already been redeemed');
    }

    const inviterId = invitation.invitedBy.toHexString();
    const inviteeAward = await this.coinsService.award(
      inviteeUserId,
      CoinType.REFERRAL_INVITEE,
      invitationId,
      undefined,
      inviterId,
    );
    const inviterAward = await this.coinsService.award(
      inviterId,
      CoinType.INVITE,
      invitationId,
      undefined,
      inviteeUserId,
    );

    void this.notifyReferralRewards({
      inviterId,
      inviteeUserId,
      inviterAwarded: inviterAward.awarded,
      inviteeAwarded: inviteeAward.awarded,
    });

    return {
      inviteeCoins: inviteeAward.awarded,
      inviterCoins: inviterAward.awarded,
      balance: inviteeAward.balance,
    };
  }

  private async notifyReferralRewards(params: {
    inviterId: string;
    inviteeUserId: string;
    inviterAwarded: number;
    inviteeAwarded: number;
  }): Promise<void> {
    try {
      const [invitee, inviter] = await Promise.all([
        this.usersService.findById(params.inviteeUserId),
        this.usersService.findById(params.inviterId),
      ]);
      const inviteeName =
        invitee?.displayName?.trim() ||
        invitee?.username?.trim() ||
        'Someone';
      const inviterName =
        inviter?.displayName?.trim() ||
        inviter?.username?.trim() ||
        'Your friend';

      if (params.inviterAwarded > 0) {
        await this.notificationsService.create({
          userId: params.inviterId,
          type: 'REFERRAL_JOINED',
          title: `+${params.inviterAwarded} referral points`,
          body: `${inviteeName} joined using your invite code`,
          referenceId: params.inviteeUserId,
          referenceType: 'POINTS',
          actorId: params.inviteeUserId,
          actorName: inviteeName,
        });
      }

      if (params.inviteeAwarded > 0) {
        await this.notificationsService.create({
          userId: params.inviteeUserId,
          type: 'REFERRAL_REDEEMED',
          title: `+${params.inviteeAwarded} referral points`,
          body: `You joined with ${inviterName}'s invite code`,
          referenceId: params.inviterId,
          referenceType: 'POINTS',
          actorId: params.inviterId,
          actorName: inviterName,
        });
      }
    } catch {
      /* notifications must not block referral fulfillment */
    }
  }

  async listAll(status?: InvitationStatus): Promise<InvitationDocument[]> {
    const filter = status ? { status } : {};
    return this.invitationModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  async cancel(id: string): Promise<void> {
    const result = await this.invitationModel.findByIdAndDelete(id).exec();
    if (!result) throw new NotFoundException('Invitation not found');
  }

  async resend(id: string): Promise<void> {
    const invitation = await this.invitationModel.findById(id).exec();
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException('Only pending invitations can be resent');
    }

    const rawToken = randomBytes(32).toString('hex');
    invitation.tokenHash = sha256(rawToken);
    invitation.expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    if (!invitation.referralCode) {
      invitation.referralCode = await this.uniqueReferralCode();
    }
    await invitation.save();

    const inviter = await this.usersService.findById(
      invitation.invitedBy.toHexString(),
    );
    const inviterName =
      inviter?.displayName ?? inviter?.username ?? 'A CTrend user';
    const frontend = resolveFrontendUrl(this.config);
    const inviteUrl = this.buildInviteUrl(
      frontend,
      invitation.role,
      invitation.email,
      invitation.referralCode,
      rawToken,
    );
    await this.mailService.sendInvitationEmail(
      invitation.email,
      inviteUrl,
      inviterName,
      invitation.referralCode,
    );
  }

  private buildInviteUrl(
    frontend: string,
    targetRole: UserRole,
    email: string,
    referralCode: string,
    rawToken: string,
  ): string {
    if (targetRole === UserRole.ADMIN) {
      return `${frontend}/accept-invitation?token=${rawToken}`;
    }
    const params = new URLSearchParams({
      email,
      referralCode,
    });
    return `${frontend}/signup?${params.toString()}`;
  }

  async signupInfoByRawToken(rawToken: string): Promise<{
    email: string;
    referralCode: string;
    role: UserRole;
  } | null> {
    const invitation = await this.findByRawToken(rawToken);
    if (!invitation) return null;
    if (invitation.status !== InvitationStatus.PENDING) return null;
    if (invitation.expiresAt <= new Date()) return null;
    return {
      email: invitation.email,
      referralCode: invitation.referralCode ?? '',
      role: invitation.role,
    };
  }
}
