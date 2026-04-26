import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type VoteDocument = HydratedDocument<Vote> & {
  createdAt: Date;
  updatedAt: Date;
};

@Schema({ timestamps: true })
export class Vote {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Post', required: true })
  postId: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  selectedOptionIndex: number;

  @Prop({ default: false })
  anonymous: boolean;
}

export const VoteSchema = SchemaFactory.createForClass(Vote);
VoteSchema.index({ userId: 1, postId: 1 }, { unique: true });
