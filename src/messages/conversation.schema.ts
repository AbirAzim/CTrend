import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ConversationType = 'direct' | 'group' | 'moderator';

export type ConversationDocument = HydratedDocument<Conversation> & {
  createdAt: Date;
  updatedAt: Date;
};

@Schema({ timestamps: true })
export class Conversation {
  @Prop({ type: String, enum: ['direct', 'group', 'moderator'], required: true })
  type: ConversationType;

  @Prop({ type: [Types.ObjectId], ref: 'User', required: true })
  participantIds: Types.ObjectId[];

  @Prop({ trim: true })
  name?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ trim: true })
  lastMessageText?: string;

  @Prop({ type: Date })
  lastMessageAt?: Date;

  // unreadCounts stored as plain object: { [userId]: count }
  @Prop({ type: Object, default: {} })
  unreadCounts: Record<string, number>;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);
ConversationSchema.index({ participantIds: 1, type: 1 });
ConversationSchema.index({ participantIds: 1, lastMessageAt: -1 });
