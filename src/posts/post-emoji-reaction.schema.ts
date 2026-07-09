import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PostEmojiReactionDocument = HydratedDocument<PostEmojiReaction>;

/**
 * One emoji reaction per user per post (👍 ❤️ 😂 😮 😢 🔥 — see
 * `POST_REACTION_EMOJIS`). Separate from `PostReaction` (the older
 * like/hype boolean toggles) so existing hype/like storage, coin, and
 * notification logic keep working unmodified; `PostsService.setPostReaction`
 * layers this on top and still calls `setReaction(..., 'hype', active)` for
 * the coin/notification/hypeCount side effects.
 */
@Schema({ timestamps: true })
export class PostEmojiReaction {
  @Prop({ type: Types.ObjectId, ref: 'Post', required: true })
  postId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  emoji: string;
}

export const PostEmojiReactionSchema =
  SchemaFactory.createForClass(PostEmojiReaction);
PostEmojiReactionSchema.index({ postId: 1, userId: 1 }, { unique: true });
PostEmojiReactionSchema.index({ postId: 1 });
