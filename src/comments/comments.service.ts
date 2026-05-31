import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Comment, CommentDocument } from './comment.schema';
import {
  CommentReaction,
  CommentReactionDocument,
} from './comment-reaction.schema';
import {
  COMMENT_REACTION_EMOJIS,
  isCommentReactionEmoji,
} from './comment-reaction.constants';
import { Post, PostDocument } from '../posts/post.schema';
import { UsersService } from '../users/users.service';
import { CommentGql, CommentReactionCountGql } from './graphql/comment.types';
import { UserDocument } from '../users/user.schema';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class CommentsService {
  constructor(
    @InjectModel(Comment.name) private commentModel: Model<CommentDocument>,
    @InjectModel(CommentReaction.name)
    private commentReactionModel: Model<CommentReactionDocument>,
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    private usersService: UsersService,
    private notificationsService: NotificationsService,
  ) {}

  private async actorName(userId: string): Promise<string> {
    const user = await this.usersService.findById(userId);
    return user?.displayName?.trim() || user?.username || 'Someone';
  }

  async create(
    userId: string,
    postId: string,
    content: string,
    parentId?: string,
  ): Promise<CommentDocument> {
    const post = await this.postModel.findById(postId);
    if (!post) throw new NotFoundException('Post not found');
    if (post.commentsDisabled) {
      throw new ForbiddenException('Comments are disabled on this post');
    }

    let parentComment: CommentDocument | null = null;
    if (parentId) {
      parentComment = await this.commentModel.findById(parentId).exec();
      if (!parentComment)
        throw new NotFoundException('Parent comment not found');
      if (parentComment.postId.toHexString() !== postId) {
        throw new BadRequestException('Reply must be on the same post');
      }
      if (parentComment.parentId) {
        throw new BadRequestException(
          'Replies are only allowed on top-level comments',
        );
      }
    }

    const doc = await this.commentModel.create({
      postId: new Types.ObjectId(postId),
      userId: new Types.ObjectId(userId),
      content,
      parentId: parentId ? new Types.ObjectId(parentId) : undefined,
    });

    const name = await this.actorName(userId);

    try {
      if (parentComment) {
        await this.notificationsService.createOrUpdateGrouped({
          userId: parentComment.userId.toHexString(),
          type: 'COMMENT_REPLY',
          referenceId: parentComment._id.toHexString(),
          referenceType: 'Comment',
          postId,
          actorId: userId,
          actorName: name,
          verbPhrase: 'replied to your comment',
          title: 'New reply to your comment',
        });
      } else {
        await this.notificationsService.createOrUpdateGrouped({
          userId: post.createdBy.toHexString(),
          type: 'POST_COMMENT',
          referenceId: postId,
          referenceType: 'Post',
          postId,
          actorId: userId,
          actorName: name,
          verbPhrase: 'commented on your post',
          title: 'New comment on your post',
        });
      }
    } catch {
      // Don't fail the comment create if notification fan-out fails
    }

    return doc;
  }

  private async reactionCountsForComment(
    commentId: Types.ObjectId,
  ): Promise<CommentReactionCountGql[]> {
    const rows = await this.commentReactionModel
      .aggregate<{
        _id: string;
        count: number;
      }>([
        { $match: { commentId } },
        { $group: { _id: '$emoji', count: { $sum: 1 } } },
      ])
      .exec();

    const order = new Map(COMMENT_REACTION_EMOJIS.map((e, i) => [e, i]));
    return rows
      .map((r) => ({ emoji: r._id, count: r.count }))
      .sort(
        (a, b) =>
          (order.get(a.emoji as (typeof COMMENT_REACTION_EMOJIS)[number]) ??
            99) -
          (order.get(b.emoji as (typeof COMMENT_REACTION_EMOJIS)[number]) ??
            99),
      );
  }

  async toGql(c: CommentDocument, viewerId?: string): Promise<CommentGql> {
    const author = await this.usersService.findById(c.userId.toString());
    if (!author) throw new NotFoundException('Author missing');

    const reactions = await this.reactionCountsForComment(c._id);
    const likeCount = reactions.reduce((sum, r) => sum + r.count, 0);

    let viewerReaction: string | undefined;
    if (viewerId) {
      const mine = await this.commentReactionModel
        .findOne({
          commentId: c._id,
          userId: new Types.ObjectId(viewerId),
        })
        .exec();
      viewerReaction = mine?.emoji;
    }

    return {
      id: c._id.toHexString(),
      postId: c.postId.toHexString(),
      author: this.usersService.toGql(author as UserDocument),
      content: c.content,
      parentId: c.parentId?.toHexString(),
      reactions,
      viewerReaction,
      likeCount,
      viewerHasLiked: viewerReaction === '❤️' || viewerReaction === '👍',
      createdAt: c.createdAt ?? new Date(),
    };
  }

  async listByPost(postId: string, viewerId?: string): Promise<CommentGql[]> {
    const rows = await this.commentModel
      .find({ postId: new Types.ObjectId(postId) })
      .sort({ createdAt: 1 })
      .exec();
    const out: CommentGql[] = [];
    for (const c of rows) {
      out.push(await this.toGql(c, viewerId));
    }
    return out;
  }

  async listMostRecentByPost(
    postId: string,
    limit = 2,
    viewerId?: string,
  ): Promise<CommentGql[]> {
    const rows = await this.commentModel
      .find({
        postId: new Types.ObjectId(postId),
        parentId: { $exists: false },
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
    return Promise.all(rows.map((c) => this.toGql(c, viewerId)));
  }

  async countByPost(postId: string): Promise<number> {
    return this.commentModel
      .countDocuments({ postId: new Types.ObjectId(postId) })
      .exec();
  }

  async setCommentReaction(
    userId: string,
    commentId: string,
    emoji: string | null,
  ): Promise<CommentGql> {
    const comment = await this.commentModel.findById(commentId).exec();
    if (!comment) throw new NotFoundException('Comment not found');

    const uid = new Types.ObjectId(userId);
    const cid = comment._id;
    const postId = comment.postId.toHexString();

    if (emoji === null || emoji === '') {
      await this.commentReactionModel.deleteOne({
        commentId: cid,
        userId: uid,
      });
      return this.toGql(comment, userId);
    }

    if (!isCommentReactionEmoji(emoji)) {
      throw new BadRequestException('Invalid reaction emoji');
    }

    const hadReaction = await this.commentReactionModel
      .findOne({ commentId: cid, userId: uid })
      .exec();

    await this.commentReactionModel.updateOne(
      { commentId: cid, userId: uid },
      { $set: { emoji } },
      { upsert: true },
    );

    if (!hadReaction || hadReaction.emoji !== emoji) {
      try {
        const name = await this.actorName(userId);
        await this.notificationsService.createOrUpdateGrouped({
          userId: comment.userId.toHexString(),
          type: 'COMMENT_REACTION',
          referenceId: comment._id.toHexString(),
          referenceType: 'Comment',
          postId,
          actorId: userId,
          actorName: name,
          verbPhrase: `reacted ${emoji} to your comment`,
          title: 'New reaction on your comment',
        });
      } catch {
        /* non-fatal */
      }
    }

    return this.toGql(comment, userId);
  }

  /** @deprecated use setCommentReaction */
  async setCommentLike(
    userId: string,
    commentId: string,
    liked: boolean,
  ): Promise<CommentGql> {
    return this.setCommentReaction(userId, commentId, liked ? '❤️' : null);
  }
}
