import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CommentDocument = HydratedDocument<Comment> & {
  createdAt: Date;
  updatedAt: Date;
};

@Schema({ timestamps: true })
export class Comment {
  @Prop({ type: Types.ObjectId, ref: 'Post', required: true })
  postId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 5000 })
  content: string;

  @Prop({ type: Types.ObjectId, ref: 'Comment' })
  parentId?: Types.ObjectId;

  /** The user this reply addresses ("Replying to <name>"). Flattened: a reply to
   * a reply still has `parentId` = top-level comment, but records who it answers. */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  replyToUserId?: Types.ObjectId;

  /** Denormalised display name of `replyToUserId`, for the reply label. */
  @Prop({ trim: true })
  replyToName?: string;

  /** Set when the author edits the comment — clients show an "edited" label. */
  @Prop({ type: Date })
  editedAt?: Date;
}

export const CommentSchema = SchemaFactory.createForClass(Comment);
/** Feed + commentsByPost: all comments on a post, sorted by time */
CommentSchema.index({ postId: 1, createdAt: 1 });
CommentSchema.index({ postId: 1, createdAt: -1 });
/** recentComments preview: top-level only, newest first */
CommentSchema.index(
  { postId: 1, createdAt: -1 },
  {
    partialFilterExpression: { parentId: { $exists: false } },
    name: 'comment_post_toplevel_created',
  },
);
CommentSchema.index({ parentId: 1, createdAt: 1 });
