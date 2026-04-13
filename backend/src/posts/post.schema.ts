import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { OrgPostReach, PostType, Visibility } from '../common/enums';

export type PostOption = { label: string; imageUrl?: string };

export type PostDocument = HydratedDocument<Post> & {
  createdAt: Date;
  updatedAt: Date;
};

@Schema({ timestamps: true })
export class Post {
  @Prop({ type: String, enum: PostType, required: true })
  type: PostType;

  @Prop({ trim: true })
  contentText?: string;

  @Prop({ type: [String], default: [] })
  imageUrls: string[];

  @Prop({
    type: [
      {
        label: { type: String, required: true },
        imageUrl: { type: String },
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
}

export const PostSchema = SchemaFactory.createForClass(Post);
PostSchema.index({ createdAt: -1 });
PostSchema.index({ feedPriority: -1, voteCount: -1 });
