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
import { CoinsService } from '../coins/coins.service';
import { CoinType } from '../coins/coins.constants';
import { Logger } from '@nestjs/common';
import { POST_UPDATED, pubsub } from '../pubsub';

/** How far back to look for the "most engaged" preview pick — bounds cost on
 * heavily-commented posts; not a true all-time top comment. */
const PREVIEW_WINDOW_SIZE = 50;

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    @InjectModel(Comment.name) private commentModel: Model<CommentDocument>,
    @InjectModel(CommentReaction.name)
    private commentReactionModel: Model<CommentReactionDocument>,
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    private usersService: UsersService,
    private notificationsService: NotificationsService,
    private coinsService: CoinsService,
  ) {}

  /** Piggybacks comment-preview updates onto the existing postUpdated channel
   * that FeedPostCard already subscribes to per post (no new subscription). */
  private async publishPostUpdated(postId: string): Promise<void> {
    try {
      await pubsub.publish(POST_UPDATED, { postUpdated: { postId } });
    } catch (err) {
      this.logger.warn(
        `PubSub publish failed for ${POST_UPDATED}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

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
    let effectiveParentId: Types.ObjectId | undefined;
    let replyToUserId: Types.ObjectId | undefined;
    let replyToName: string | undefined;
    if (parentId) {
      parentComment = await this.commentModel.findById(parentId).exec();
      if (!parentComment)
        throw new NotFoundException('Parent comment not found');
      if (parentComment.postId.toHexString() !== postId) {
        throw new BadRequestException('Reply must be on the same post');
      }
      // Flatten to a single nesting level (Facebook-style): a reply to a reply
      // attaches to the top-level comment but records who it addresses.
      effectiveParentId = parentComment.parentId ?? parentComment._id;
      replyToUserId = parentComment.userId;
      replyToName = await this.actorName(parentComment.userId.toHexString());
    }

    const doc = await this.commentModel.create({
      postId: new Types.ObjectId(postId),
      userId: new Types.ObjectId(userId),
      content,
      parentId: effectiveParentId,
      replyToUserId,
      replyToName,
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
          commentId: doc._id.toHexString(),
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
          commentId: doc._id.toHexString(),
          actorId: userId,
          actorName: name,
          verbPhrase: 'commented on your post',
          title: 'New comment on your post',
        });
      }
    } catch {
      // Don't fail the comment create if notification fan-out fails
    }

    // Coins: reward the commenter (once per comment).
    await this.coinsService.award(
      userId,
      CoinType.COMMENT,
      doc._id.toHexString(),
    );

    await this.publishPostUpdated(postId);

    return doc;
  }

  private sortReactionCounts(
    reactions: CommentReactionCountGql[],
  ): CommentReactionCountGql[] {
    const order = new Map(COMMENT_REACTION_EMOJIS.map((e, i) => [e, i]));
    return [...reactions].sort(
      (a, b) =>
        (order.get(a.emoji as (typeof COMMENT_REACTION_EMOJIS)[number]) ?? 99) -
        (order.get(b.emoji as (typeof COMMENT_REACTION_EMOJIS)[number]) ?? 99),
    );
  }

  private async reactionCountsForComment(
    commentId: Types.ObjectId,
  ): Promise<CommentReactionCountGql[]> {
    const map = await this.batchReactionCountsMap([commentId]);
    return map.get(commentId.toHexString()) ?? [];
  }

  /** One aggregation for all comment reactions on a post (avoids N+1). */
  private async batchReactionCountsMap(
    commentIds: Types.ObjectId[],
  ): Promise<Map<string, CommentReactionCountGql[]>> {
    if (commentIds.length === 0) return new Map();

    const rows = await this.commentReactionModel
      .aggregate<{
        commentId: Types.ObjectId;
        emoji: string;
        count: number;
      }>([
        { $match: { commentId: { $in: commentIds } } },
        {
          $group: {
            _id: { commentId: '$commentId', emoji: '$emoji' },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            commentId: '$_id.commentId',
            emoji: '$_id.emoji',
            count: 1,
          },
        },
      ])
      .exec();

    const map = new Map<string, CommentReactionCountGql[]>();
    for (const row of rows) {
      const key = row.commentId.toHexString();
      const list = map.get(key) ?? [];
      list.push({ emoji: row.emoji, count: row.count });
      map.set(key, list);
    }
    for (const [key, list] of map) {
      map.set(key, this.sortReactionCounts(list));
    }
    return map;
  }

  private async batchViewerReactionsMap(
    commentIds: Types.ObjectId[],
    viewerId: string,
  ): Promise<Map<string, string>> {
    if (commentIds.length === 0) return new Map();
    const rows = await this.commentReactionModel
      .find({
        commentId: { $in: commentIds },
        userId: new Types.ObjectId(viewerId),
      })
      .select({ commentId: 1, emoji: 1 })
      .lean()
      .exec();
    return new Map(rows.map((r) => [r.commentId.toHexString(), r.emoji]));
  }

  private rowsToGql(
    rows: CommentDocument[],
    authorById: Map<string, UserDocument>,
    reactionsByCommentId: Map<string, CommentReactionCountGql[]>,
    viewerReactionsByCommentId: Map<string, string>,
  ): CommentGql[] {
    return rows.map((c) => {
      const author = authorById.get(c.userId.toHexString());
      if (!author) throw new NotFoundException('Author missing');

      const reactions = reactionsByCommentId.get(c._id.toHexString()) ?? [];
      const viewerReaction = viewerReactionsByCommentId.get(
        c._id.toHexString(),
      );
      const likeCount = reactions.reduce((sum, r) => sum + r.count, 0);

      return {
        id: c._id.toHexString(),
        postId: c.postId.toHexString(),
        author: this.usersService.toGql(author),
        content: c.content,
        parentId: c.parentId?.toHexString(),
        reactions,
        viewerReaction,
        likeCount,
        viewerHasLiked: viewerReaction === '❤️' || viewerReaction === '👍',
        createdAt: c.createdAt ?? new Date(),
        editedAt: c.editedAt,
        replyToName: c.replyToName,
        replyToUserId: c.replyToUserId?.toHexString(),
      };
    });
  }

  /** Edits a top-level or reply comment — author only. Flags it as edited. */
  async editComment(
    userId: string,
    commentId: string,
    content: string,
  ): Promise<CommentGql> {
    const trimmed = content.trim();
    if (!trimmed) throw new BadRequestException('Comment cannot be empty');

    const comment = await this.commentModel.findById(commentId).exec();
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId.toHexString() !== userId) {
      throw new ForbiddenException('You can only edit your own comment');
    }

    comment.content = trimmed;
    comment.editedAt = new Date();
    await comment.save();

    return this.toGql(comment, userId);
  }

  /**
   * Deletes a comment — author only. Deleting a top-level comment cascades to all
   * its replies (and every comment's reactions). Returns the removed comment ids.
   */
  async deleteComment(userId: string, commentId: string): Promise<string[]> {
    const comment = await this.commentModel.findById(commentId).exec();
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId.toHexString() !== userId) {
      throw new ForbiddenException('You can only delete your own comment');
    }

    // Top-level comment → also remove its replies.
    const replyIds = comment.parentId
      ? []
      : (
          await this.commentModel
            .find({ parentId: comment._id })
            .select('_id')
            .exec()
        ).map((r) => r._id);
    const allIds = [comment._id, ...replyIds];

    await this.commentReactionModel
      .deleteMany({ commentId: { $in: allIds } })
      .exec();
    await this.commentModel.deleteMany({ _id: { $in: allIds } }).exec();

    await this.publishPostUpdated(comment.postId.toHexString());

    return allIds.map((id) => id.toHexString());
  }

  private async hydrateCommentsToGql(
    rows: CommentDocument[],
    viewerId?: string,
  ): Promise<CommentGql[]> {
    if (rows.length === 0) return [];

    const commentIds = rows.map((c) => c._id);
    const userIds = rows.map((c) => c.userId.toHexString());

    const [users, reactionsByCommentId, viewerReactionsByCommentId] =
      await Promise.all([
        this.usersService.findByIds(userIds),
        this.batchReactionCountsMap(commentIds),
        viewerId
          ? this.batchViewerReactionsMap(commentIds, viewerId)
          : Promise.resolve(new Map<string, string>()),
      ]);

    const authorById = new Map(users.map((u) => [u._id.toHexString(), u]));
    return this.rowsToGql(
      rows,
      authorById,
      reactionsByCommentId,
      viewerReactionsByCommentId,
    );
  }

  async toGql(c: CommentDocument, viewerId?: string): Promise<CommentGql> {
    const [row] = await this.hydrateCommentsToGql([c], viewerId);
    return row;
  }

  async listByPost(postId: string, viewerId?: string): Promise<CommentGql[]> {
    const rows = await this.commentModel
      .find({ postId: new Types.ObjectId(postId) })
      .sort({ createdAt: 1 })
      .exec();
    return this.hydrateCommentsToGql(rows, viewerId);
  }

  /**
   * Feed/post preview comments: the most-engaged top-level comment (if it has
   * any reactions) plus the most recent one, deduped and capped at `limit`.
   * "Most engaged" is scoped to the `PREVIEW_WINDOW_SIZE` most recent
   * top-level comments (not all-time) to bound cost on heavily-commented posts.
   */
  async listPreviewComments(
    postId: string,
    limit = 2,
    viewerId?: string,
  ): Promise<CommentGql[]> {
    const recentRows = await this.commentModel
      .find({
        postId: new Types.ObjectId(postId),
        parentId: { $exists: false },
      })
      .sort({ createdAt: -1 })
      .limit(PREVIEW_WINDOW_SIZE)
      .exec();
    if (recentRows.length === 0) return [];

    const reactionsByCommentId = await this.batchReactionCountsMap(
      recentRows.map((r) => r._id),
    );

    const mostRecent = recentRows[0];
    let topEngaged: CommentDocument | undefined;
    let topEngagedCount = 0;
    for (const row of recentRows) {
      const count = (
        reactionsByCommentId.get(row._id.toHexString()) ?? []
      ).reduce((sum, r) => sum + r.count, 0);
      if (count > topEngagedCount) {
        topEngagedCount = count;
        topEngaged = row;
      }
    }

    const selected: CommentDocument[] = [];
    if (topEngaged && topEngagedCount > 0) selected.push(topEngaged);
    if (!selected.some((c) => c._id.equals(mostRecent._id))) {
      selected.push(mostRecent);
    }

    const ordered = selected
      .slice(0, limit)
      .sort(
        (a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
      );

    return this.hydrateCommentsToGql(ordered, viewerId);
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
      await this.publishPostUpdated(postId);
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
          commentId: comment._id.toHexString(),
          actorId: userId,
          actorName: name,
          verbPhrase: `reacted ${emoji} to your comment`,
          title: 'New reaction on your comment',
        });
      } catch {
        /* non-fatal */
      }
    }

    await this.publishPostUpdated(postId);
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
