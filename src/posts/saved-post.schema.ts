import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SavedPostDocument = HydratedDocument<SavedPost>;

@Schema({ timestamps: true })
export class SavedPost {
  @Prop({ type: Types.ObjectId, ref: 'Post', required: true })
  postId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;
}

export const SavedPostSchema = SchemaFactory.createForClass(SavedPost);
SavedPostSchema.index({ postId: 1, userId: 1 }, { unique: true });
SavedPostSchema.index({ userId: 1, createdAt: -1 });
