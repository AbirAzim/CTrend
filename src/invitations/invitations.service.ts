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
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class InvitationsService {
  constructor(
    @InjectModel(Invitation.name) private invitationModel: Model<InvitationDocument>,
    private usersService: UsersService,
    private mailService: MailService,
    private config: ConfigService,
  ) {}

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
    await this.invitationModel.create({
      tokenHash: sha256(rawToken),
      email: normalized,
      invitedBy: new Types.ObjectId(inviterId),
      role: targetRole,
      status: InvitationStatus.PENDING,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });

    const inviter = await this.usersService.findById(inviterId);
    const inviterName = inviter?.displayName ?? inviter?.username ?? 'A CTrend user';
    const frontend = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const inviteUrl = `${frontend}/accept-invitation?token=${rawToken}`;
    await this.mailService.sendInvitationEmail(normalized, inviteUrl, inviterName);

    return true;
  }

  async findByRawToken(rawToken: string): Promise<InvitationDocument | null> {
    return this.invitationModel.findOne({
      tokenHash: sha256(rawToken),
      status: InvitationStatus.PENDING,
      expiresAt: { $gt: new Date() },
    });
  }

  async markAccepted(invitationId: string): Promise<void> {
    await this.invitationModel.findByIdAndUpdate(invitationId, {
      status: InvitationStatus.ACCEPTED,
    });
  }
}
