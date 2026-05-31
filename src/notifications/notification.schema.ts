import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NotificationType =
  | 'MESSAGE'
  | 'ANNOUNCEMENT'
  | 'FRIEND_REQUEST'
  | 'NEW_POST_FRIEND'
  | 'POST_HYPE'
  | 'POST_COMMENT'
  | 'COMMENT_REPLY'
  | 'COMMENT_REACTION'
  | 'SYSTEM';

export type NotificationDocument = HydratedDocument<Notification>;

@Schema({ timestamps: true })
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: [
      'MESSAGE',
      'ANNOUNCEMENT',
      'FRIEND_REQUEST',
      'NEW_POST_FRIEND',
      'POST_HYPE',
      'POST_COMMENT',
      'COMMENT_REPLY',
      'COMMENT_REACTION',
      'SYSTEM',
    ],
    required: true,
  })
  type: NotificationType;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  body: string;

  @Prop({ type: String })
  referenceId?: string;

  @Prop({ type: String })
  referenceType?: string;

  /** Post id for deep-linking comment notifications */
  @Prop({ type: String })
  postId?: string;

  /** Number of distinct actors that triggered this grouped notification */
  @Prop({ type: Number, default: 1 })
  actorCount: number;

  /** Display name of the most recent actor (e.g. "Anjon hyped your post") */
  @Prop({ type: String })
  latestActorName?: string;

  /** Actor's user id — used so we don't double-count the same actor */
  @Prop({ type: String })
  latestActorId?: string;

  @Prop({ default: false })
  read: boolean;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, createdAt: -1 });
// Index for grouped-notification lookups (POST_HYPE, POST_COMMENT)
NotificationSchema.index({
  userId: 1,
  type: 1,
  referenceId: 1,
  read: 1,
});
