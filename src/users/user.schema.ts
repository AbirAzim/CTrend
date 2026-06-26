import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { UserRole } from '../common/enums';

export type UserDocument = HydratedDocument<User>;

/** A registered device push token (FCM/APNs) for mobile notifications. */
export interface PushToken {
  token: string;
  platform?: string;
  updatedAt: Date;
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, trim: true })
  username: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  /** Shown to clients as displayName (signup / Google). */
  @Prop({ trim: true })
  displayName?: string;

  @Prop({ sparse: true, unique: true })
  googleSub?: string;

  @Prop({ required: true })
  password: string;

  @Prop({ type: [String], default: [] })
  interests: string[];

  /** Legacy single-role field — kept for backward compat with existing documents. */
  @Prop({ type: String, enum: UserRole, default: UserRole.USER })
  role: UserRole;

  /** All roles this user holds. Supersedes `role` when present. */
  @Prop({ type: [String], enum: UserRole, default: [UserRole.USER] })
  roles: UserRole[];

  @Prop({ trim: true })
  bio?: string;

  @Prop()
  profileImageUrl?: string;

  @Prop({ trim: true, default: 'buzz-in' })
  voteSoundId?: string;

  @Prop({ trim: true, default: 'ascending-chime' })
  notificationSoundId?: string;

  @Prop({ trim: true, default: 'gentle-ping' })
  messageSoundId?: string;

  @Prop({ default: false })
  emailVerified: boolean;

  @Prop()
  emailVerificationCode?: string;

  @Prop()
  emailVerificationExpiry?: Date;

  @Prop()
  passwordResetToken?: string;

  @Prop()
  passwordResetExpiry?: Date;

  /** Registered device push tokens (FCM/APNs) for mobile push notifications. */
  @Prop({
    type: [
      {
        token: { type: String, required: true },
        platform: { type: String },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  pushTokens: PushToken[];

  /** Last Android versionCode reported by the mobile app (X-Android-Version-Code header). */
  @Prop({ default: 0 })
  lastAndroidVersionCode?: number;

  /** Gamification — lifetime coin balance (cached sum of the coin ledger). */
  @Prop({ default: 0 })
  coins: number;

  /** Last day the daily-streak bonus was claimed (used to gate one/day). */
  @Prop({ type: Date, default: null })
  lastStreakAt?: Date | null;

  /** Consecutive-day streak length. */
  @Prop({ default: 0 })
  streakDays?: number;

  /** Mongoose `timestamps: true` — earlier accounts rank higher on coin ties. */
  createdAt?: Date;

  updatedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
// Coin leaderboard: find({ coins: { $gt: 0 } }).sort({ coins: -1 })
UserSchema.index({ coins: -1 });
