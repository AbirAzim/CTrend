import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/user.schema';
import { Post, PostDocument } from '../posts/post.schema';
import { SavedPost, SavedPostDocument } from '../posts/saved-post.schema';
import {
  PostReaction,
  PostReactionDocument,
} from '../posts/post-reaction.schema';
import { Vote, VoteDocument } from '../votes/vote.schema';
import { Comment, CommentDocument } from '../comments/comment.schema';
import {
  CommentLike,
  CommentLikeDocument,
} from '../comments/comment-like.schema';
import {
  CommentReaction,
  CommentReactionDocument,
} from '../comments/comment-reaction.schema';
import { Follow, FollowDocument } from '../follows/follow.schema';
import {
  Notification,
  NotificationDocument,
} from '../notifications/notification.schema';
import {
  ContentReport,
  ContentReportDocument,
} from '../content-reports/content-report.schema';
import { Message, MessageDocument } from '../messages/message.schema';
import {
  MessageReaction,
  MessageReactionDocument,
} from '../messages/message-reaction.schema';
import {
  Conversation,
  ConversationDocument,
} from '../messages/conversation.schema';
import {
  PromotionToken,
  PromotionTokenDocument,
} from '../promotion-tokens/promotion-token.schema';
import { ContentReportTargetType } from '../common/enums';

@Injectable()
export class AccountDeletionService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Post.name) private readonly postModel: Model<PostDocument>,
    @InjectModel(SavedPost.name)
    private readonly savedPostModel: Model<SavedPostDocument>,
    @InjectModel(PostReaction.name)
    private readonly postReactionModel: Model<PostReactionDocument>,
    @InjectModel(Vote.name) private readonly voteModel: Model<VoteDocument>,
    @InjectModel(Comment.name)
    private readonly commentModel: Model<CommentDocument>,
    @InjectModel(CommentLike.name)
    private readonly commentLikeModel: Model<CommentLikeDocument>,
    @InjectModel(CommentReaction.name)
    private readonly commentReactionModel: Model<CommentReactionDocument>,
    @InjectModel(Follow.name)
    private readonly followModel: Model<FollowDocument>,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(ContentReport.name)
    private readonly contentReportModel: Model<ContentReportDocument>,
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    @InjectModel(MessageReaction.name)
    private readonly messageReactionModel: Model<MessageReactionDocument>,
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(PromotionToken.name)
    private readonly promotionTokenModel: Model<PromotionTokenDocument>,
  ) {}

  async deleteAllDataForUser(userId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) return false;
    const uid = new Types.ObjectId(userId);

    const authorPosts = await this.postModel
      .find({ createdBy: uid }, { _id: 1 })
      .lean()
      .exec();
    const postIds = authorPosts.map((p) => p._id as Types.ObjectId);

    const userComments = await this.commentModel
      .find({ userId: uid }, { _id: 1 })
      .lean()
      .exec();
    const commentIds = userComments.map((c) => c._id as Types.ObjectId);

    if (commentIds.length > 0) {
      await Promise.all([
        this.commentLikeModel
          .deleteMany({ commentId: { $in: commentIds } })
          .exec(),
        this.commentReactionModel
          .deleteMany({ commentId: { $in: commentIds } })
          .exec(),
      ]);
    }

    if (postIds.length > 0) {
      const postComments = await this.commentModel
        .find({ postId: { $in: postIds } }, { _id: 1 })
        .lean()
        .exec();
      const postCommentIds = postComments.map((c) => c._id as Types.ObjectId);
      if (postCommentIds.length > 0) {
        await Promise.all([
          this.commentLikeModel
            .deleteMany({ commentId: { $in: postCommentIds } })
            .exec(),
          this.commentReactionModel
            .deleteMany({ commentId: { $in: postCommentIds } })
            .exec(),
        ]);
      }

      await Promise.all([
        this.postModel.deleteMany({ _id: { $in: postIds } }).exec(),
        this.savedPostModel.deleteMany({ postId: { $in: postIds } }).exec(),
        this.postReactionModel.deleteMany({ postId: { $in: postIds } }).exec(),
        this.commentModel.deleteMany({ postId: { $in: postIds } }).exec(),
        this.voteModel.deleteMany({ postId: { $in: postIds } }).exec(),
        this.contentReportModel
          .deleteMany({
            targetType: ContentReportTargetType.POST,
            targetId: { $in: postIds },
          })
          .exec(),
      ]);
    }

    await Promise.all([
      this.voteModel.deleteMany({ userId: uid }).exec(),
      this.savedPostModel.deleteMany({ userId: uid }).exec(),
      this.postReactionModel.deleteMany({ userId: uid }).exec(),
      this.commentModel.deleteMany({ userId: uid }).exec(),
      this.commentLikeModel.deleteMany({ userId: uid }).exec(),
      this.commentReactionModel.deleteMany({ userId: uid }).exec(),
      this.followModel
        .deleteMany({
          $or: [{ followerId: uid }, { followingId: uid }],
        })
        .exec(),
      this.notificationModel.deleteMany({ userId: uid }).exec(),
      this.contentReportModel.deleteMany({ reporterId: uid }).exec(),
      this.messageReactionModel.deleteMany({ userId: uid }).exec(),
      this.promotionTokenModel.deleteMany({ userId: uid }).exec(),
    ]);

    const userConversations = await this.conversationModel
      .find({ participantIds: uid }, { _id: 1, type: 1 })
      .lean()
      .exec();

    const conversationIds = userConversations.map(
      (c) => c._id as Types.ObjectId,
    );

    if (conversationIds.length > 0) {
      await Promise.all([
        this.messageModel
          .deleteMany({ conversationId: { $in: conversationIds } })
          .exec(),
        this.conversationModel
          .deleteMany({
            $or: [
              { type: 'moderator', participantIds: uid },
              { _id: { $in: conversationIds }, type: 'direct' },
            ],
          })
          .exec(),
        this.conversationModel
          .updateMany(
            { _id: { $in: conversationIds }, type: 'group' },
            { $pull: { participantIds: uid } },
          )
          .exec(),
      ]);
    }

    await this.messageModel.deleteMany({ senderId: uid }).exec();
    await this.messageModel.deleteMany({ sentByAdminId: uid }).exec();

    const result = await this.userModel.deleteOne({ _id: uid }).exec();
    return result.deletedCount > 0;
  }
}
