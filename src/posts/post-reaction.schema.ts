import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PostReactionKind = 'like' | 'hype';

export type PostReactionDocument = HydratedDocument<PostReaction>;

@Schema({ timestamps: true })
export class PostReaction {
  @Prop({ type: Types.ObjectId, ref: 'Post', required: true })
  postId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: ['like', 'hype'] })
  kind: PostReactionKind;
}

export const PostReactionSchema = SchemaFactory.createForClass(PostReaction);
PostReactionSchema.index({ postId: 1, userId: 1, kind: 1 }, { unique: true });
PostReactionSchema.index({ postId: 1, kind: 1 });
