import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CommentReactionDocument = HydratedDocument<CommentReaction>;

@Schema({ timestamps: true })
export class CommentReaction {
  @Prop({ type: Types.ObjectId, ref: 'Comment', required: true })
  commentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  emoji: string;
}

export const CommentReactionSchema =
  SchemaFactory.createForClass(CommentReaction);
CommentReactionSchema.index({ commentId: 1, userId: 1 }, { unique: true });
CommentReactionSchema.index({ commentId: 1 });
