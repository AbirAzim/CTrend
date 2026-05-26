import {
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { createHash, randomBytes } from 'crypto';
import {
  PromotionToken,
  PromotionTokenDocument,
} from './promotion-token.schema';
import {
  Invitation,
  InvitationDocument,
} from '../invitations/invitation.schema';
import { InvitationStatus, UserRole } from '../common/enums';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

@Injectable()
export class PromotionTokensService {
  constructor(
    @InjectModel(PromotionToken.name)
    private model: Model<PromotionTokenDocument>,
    @InjectModel(Invitation.name)
    private invitationModel: Model<InvitationDocument>,
    @Inject(forwardRef(() => UsersService)) private usersService: UsersService,
    private mailService: MailService,
    private config: ConfigService,
  ) {}

  /** Upsert an already-accepted admin invitation record for audit trail. */
  async recordPromotion(
    promotedByUserId: string,
    targetEmail: string,
  ): Promise<void> {
    const normalized = targetEmail.trim().toLowerCase();
    await this.invitationModel.updateOne(
      { email: normalized },
      {
        $set: {
          tokenHash: sha256(randomBytes(16).toString('hex')),
          invitedBy: new Types.ObjectId(promotedByUserId),
          role: UserRole.ADMIN,
          status: InvitationStatus.ACCEPTED,
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
        $setOnInsert: { email: normalized },
      },
      { upsert: true },
    );
  }

  async createAndSend(userId: string, promotedById: string): Promise<void> {
    // Remove any previous un-rejected token for this user
    await this.model.deleteMany({
      userId: new Types.ObjectId(userId),
      rejected: false,
    });

    const rawToken = randomBytes(32).toString('hex');
    await this.model.create({
      tokenHash: sha256(rawToken),
      userId: new Types.ObjectId(userId),
      promotedBy: new Types.ObjectId(promotedById),
      expiresAt: new Date(Date.now() + TTL_MS),
      rejected: false,
    });

    const user = await this.usersService.findById(userId);
    const promoter = await this.usersService.findById(promotedById);
    if (!user) return;

    const promoterName =
      promoter?.displayName ?? promoter?.username ?? 'A CTrend admin';
    const frontend = this.config.get<string>(
      'FRONTEND_URL',
      'http://localhost:5173',
    );
    const rejectUrl = `${frontend}/reject-promotion?token=${rawToken}`;
    await this.mailService.sendPromotionEmail(
      user.email,
      rejectUrl,
      promoterName,
      user.displayName ?? user.username ?? user.email,
    );
  }

  async reject(rawToken: string): Promise<void> {
    const record = await this.model.findOne({
      tokenHash: sha256(rawToken),
      rejected: false,
      expiresAt: { $gt: new Date() },
    });
    if (!record) throw new NotFoundException('Invalid or expired token');

    await this.usersService.demoteFromAdmin(
      (await this.usersService.findById(record.userId.toHexString()))!.email,
    );
    record.rejected = true;
    await record.save();
  }
}
