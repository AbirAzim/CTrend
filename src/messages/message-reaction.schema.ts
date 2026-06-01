import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MessageReactionDocument = HydratedDocument<MessageReaction>;

@Schema({ timestamps: true })
export class MessageReaction {
  @Prop({ type: Types.ObjectId, ref: 'Message', required: true })
  messageId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  emoji: string;
}

export const MessageReactionSchema =
  SchemaFactory.createForClass(MessageReaction);
MessageReactionSchema.index({ messageId: 1, userId: 1 }, { unique: true });
MessageReactionSchema.index({ messageId: 1 });
