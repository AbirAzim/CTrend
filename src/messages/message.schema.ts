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

  @Prop({
    type: [{ userId: Types.ObjectId, readAt: Date }],
    default: [],
  })
  readBy: ReadReceipt[];
}

export const MessageSchema = SchemaFactory.createForClass(Message);
MessageSchema.index({ conversationId: 1, createdAt: -1 });
MessageSchema.index({ senderId: 1 });
