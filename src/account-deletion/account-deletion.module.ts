import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/user.schema';
import { Post, PostSchema } from '../posts/post.schema';
import { SavedPost, SavedPostSchema } from '../posts/saved-post.schema';
import {
  PostReaction,
  PostReactionSchema,
} from '../posts/post-reaction.schema';
import { Vote, VoteSchema } from '../votes/vote.schema';
import { Comment, CommentSchema } from '../comments/comment.schema';
import {
  CommentLike,
  CommentLikeSchema,
} from '../comments/comment-like.schema';
import {
  CommentReaction,
  CommentReactionSchema,
} from '../comments/comment-reaction.schema';
import { Follow, FollowSchema } from '../follows/follow.schema';
import {
  Notification,
  NotificationSchema,
} from '../notifications/notification.schema';
import {
  ContentReport,
  ContentReportSchema,
} from '../content-reports/content-report.schema';
import { Message, MessageSchema } from '../messages/message.schema';
import {
  MessageReaction,
  MessageReactionSchema,
} from '../messages/message-reaction.schema';
import {
  Conversation,
  ConversationSchema,
} from '../messages/conversation.schema';
import {
  PromotionToken,
  PromotionTokenSchema,
} from '../promotion-tokens/promotion-token.schema';
import { AccountDeletionService } from './account-deletion.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Post.name, schema: PostSchema },
      { name: SavedPost.name, schema: SavedPostSchema },
      { name: PostReaction.name, schema: PostReactionSchema },
      { name: Vote.name, schema: VoteSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: CommentLike.name, schema: CommentLikeSchema },
      { name: CommentReaction.name, schema: CommentReactionSchema },
      { name: Follow.name, schema: FollowSchema },
      { name: Notification.name, schema: NotificationSchema },
      { name: ContentReport.name, schema: ContentReportSchema },
      { name: Message.name, schema: MessageSchema },
      { name: MessageReaction.name, schema: MessageReactionSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: PromotionToken.name, schema: PromotionTokenSchema },
    ]),
  ],
  providers: [AccountDeletionService],
  exports: [AccountDeletionService],
})
export class AccountDeletionModule {}
