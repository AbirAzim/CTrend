import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MessageDocument = HydratedDocument<Message> & {
  createdAt: Date;
  updatedAt: Date;
};

export class ReadReceipt {
  userId: Types.ObjectId;
  readAt: Date;
}

/**
 * Denormalised snapshot of the message this one is replying to.
 * Stored inline so the quoted preview renders without an extra lookup and
 * stays stable even if the original is later deleted.
 */
export class ReplyPreview {
  messageId: Types.ObjectId;
  /** Client-facing sender id of the quoted message ('moderator' or user hex). */
  senderId: string;
  senderName: string;
  text: string;
  imageUrl?: string | null;
}

@Schema({ timestamps: true })
export class Message {
  @Prop({ type: Types.ObjectId, ref: 'Conversation', required: true })
  conversationId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  senderId: Types.ObjectId;

  /** Real admin who sent a platform moderator message (hidden from regular users). */
  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  sentByAdminId?: Types.ObjectId;

  @Prop({ default: false })
  isModeratorMessage: boolean;

  @Prop({ required: false, trim: true, maxlength: 2000, default: '' })
  text: string;

  /** Optional image attached to the message (R2 public URL). */
  @Prop({ required: false, type: String, default: null })
  imageUrl?: string | null;

  /** Soft-delete: sender unsent the message ("message deleted" placeholder). */
  @Prop({ default: false })
  deleted: boolean;

  @Prop({
    type: [{ userId: Types.ObjectId, readAt: Date }],
    default: [],
  })
  readBy: ReadReceipt[];

  /** Quoted message snapshot when this message is a reply (Messenger-style). */
  @Prop({
    type: {
      messageId: { type: Types.ObjectId, ref: 'Message' },
      senderId: String,
      senderName: String,
      text: String,
      imageUrl: { type: String, default: null },
    },
    required: false,
    default: null,
    _id: false,
  })
  replyTo?: ReplyPreview | null;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
MessageSchema.index({ conversationId: 1, createdAt: -1 });
MessageSchema.index({ senderId: 1 });
