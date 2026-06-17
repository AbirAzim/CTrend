import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  OrgPostReach,
  PostFormat,
  PostStatus,
  PostType,
  Visibility,
} from '../common/enums';

export type PostOption = {
  label: string;
  imageUrl?: string;
  /** 0–100 CSS object-position X (default center). */
  imageFocalX?: number;
  /** 0–100 CSS object-position Y (default center). */
  imageFocalY?: number;
};

export type PostDocument = HydratedDocument<Post> & {
  createdAt: Date;
  updatedAt: Date;
};

@Schema({ timestamps: true })
export class Post {
  @Prop({ type: String, enum: PostType, required: true })
  type: PostType;

  /** Voting layout. Legacy posts default to `compare`. */
  @Prop({ type: String, enum: PostFormat, default: PostFormat.COMPARE })
  format: PostFormat;

  @Prop({ trim: true })
  contentText?: string;

  @Prop({ type: [String], default: [] })
  imageUrls: string[];

  @Prop({
    type: [
      {
        label: { type: String, required: true },
        imageUrl: { type: String },
        imageFocalX: { type: Number, min: 0, max: 100 },
        imageFocalY: { type: Number, min: 0, max: 100 },
      },
    ],
    required: true,
  })
  options: PostOption[];

  @Prop({ type: Types.ObjectId, ref: 'Category', required: true })
  categoryId: Types.ObjectId;

  @Prop({ type: String, enum: Visibility, default: Visibility.PUBLIC })
  visibility: Visibility;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Organization' })
  organizationId?: Types.ObjectId;

  /** Higher sorts first (system posts use 100) */
  @Prop({ default: 0 })
  feedPriority: number;

  @Prop({ type: String, enum: OrgPostReach })
  orgReach?: OrgPostReach;

  @Prop({ default: false })
  commentsDisabled: boolean;

  @Prop({ default: false })
  likesDisabled: boolean;

  @Prop({ default: 0 })
  voteCount: number;

  @Prop({ type: Date })
  votingEndsAt?: Date;

  /** Minutes before voting end to show "ending soon" urgency UI. */
  @Prop({ type: Number, min: 1, max: 1440, default: 5 })
  endingSoonLeadMinutes: number;

  @Prop({ type: String, enum: PostStatus, default: PostStatus.PUBLISHED })
  status: PostStatus;

  @Prop({ type: Date })
  scheduledAt?: Date;

  /** Admins who have edited this post (platform posts). */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  editedByIds: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'User' })
  lastEditedById?: Types.ObjectId;

  /**
   * Normal user chose "post globally" (platform-wide USER post).
   * Distinct from SYSTEM posts which show the platform brand, not the user.
   */
  @Prop({ default: false })
  isUserGlobalBroadcast: boolean;

  /** Optional promotional campaign this compare belongs to. */
  @Prop({ type: Types.ObjectId, ref: 'Campaign' })
  campaignId?: Types.ObjectId;

  /** Random draw winner after voting ends (identified voters only). */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  voteWinnerUserId?: Types.ObjectId;

  @Prop({ type: Number })
  voteWinnerOptionIndex?: number;

  /** Set when draw ran (even if no eligible winner). */
  @Prop({ type: Date })
  voteWinnerPickedAt?: Date;

  /** Set once vote-ended notifications were fanned out. */
  @Prop({ type: Date })
  voteEndedNotifiedAt?: Date;

  /** Set when the winner claims the prize (friend posts only). */
  @Prop({ type: Date })
  votePrizeClaimedAt?: Date;

  /** Winner user id who claimed the prize. */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  votePrizeClaimedByUserId?: Types.ObjectId;

  /** Denormalized count of user content reports (moderation queue). */
  @Prop({ default: 0, min: 0 })
  reportCount: number;

  /**
   * True for auto-scheduled fixture posts (World Cup match posts).
   * When true: voteWinner is never drawn at kickoff — the real match result
   * determines the winner via WinnerAnnouncementService after the match ends.
   */
  @Prop({ default: false })
  matchType: boolean;

  /**
   * Denormalized live/final score from the linked fixture. Updated by
   * syncLiveScores every minute while the match is active.
   */
  @Prop({
    type: {
      home: { type: Number, default: null },
      away: { type: Number, default: null },
    },
    default: null,
  })
  fixtureScore?: { home: number | null; away: number | null } | null;

  /** Normalized match status: TIMED | IN_PLAY | PAUSED | FINISHED */
  @Prop({ type: String, default: null })
  fixtureStatus?: string | null;

  /** Elapsed match minute while IN_PLAY or PAUSED; null otherwise. */
  @Prop({ type: Number, default: null })
  fixtureMinute?: number | null;

  /** When the campaign winner will be revealed after the match ends. Denormalized from Fixture.winnerScheduledAt. */
  @Prop({ type: Date, default: null })
  fixtureWinnerAt?: Date | null;

  /** MongoDB ObjectId string of the linked Fixture document (matchType posts only). */
  @Prop({ type: String, default: null })
  fixtureId?: string | null;

  /** True once lineups have been synced for this match. Used to gate the "See Details" button. */
  @Prop({ default: false })
  lineupAvailable: boolean;
}

export const PostSchema = SchemaFactory.createForClass(Post);
PostSchema.index({ createdAt: -1 });
PostSchema.index({ feedPriority: -1, voteCount: -1 });
PostSchema.index({ status: 1, scheduledAt: 1 });
// Feed filter queries: type + createdBy, and type + status + orgReach
PostSchema.index({ type: 1, createdBy: 1, status: 1 });
PostSchema.index({ type: 1, orgReach: 1, status: 1 });
PostSchema.index({ reportCount: -1, createdAt: -1 });
