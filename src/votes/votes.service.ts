import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Vote, VoteDocument } from './vote.schema';
import { Post, PostDocument } from '../posts/post.schema';
import { Follow, FollowDocument, FollowStatus } from '../follows/follow.schema';
import { POST_VOTE_UPDATED, pubsub, VOTE_UPDATED } from '../pubsub';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.schema';
import { PostType } from '../common/enums';
import { PostVoterGql } from './graphql/vote.types';

@Injectable()
export class VotesService {
  private readonly logger = new Logger(VotesService.name);

  constructor(
    @InjectModel(Vote.name) private voteModel: Model<VoteDocument>,
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    @InjectModel(Follow.name) private followModel: Model<FollowDocument>,
    private usersService: UsersService,
    @Inject(forwardRef(() => NotificationsService))
    private notificationsService: NotificationsService,
  ) {}

  /** Notify post author when someone casts a new vote (not option changes / unvote). */
  private async notifyPostAuthorOfVote(
    post: PostDocument,
    voterUserId: string,
    anonymous: boolean,
  ): Promise<void> {
    const authorId = post.createdBy.toHexString();
    if (authorId === voterUserId) return;

    let actorName = 'Someone';
    if (!anonymous) {
      const voter = await this.usersService.findById(voterUserId);
      actorName = voter?.displayName?.trim() || voter?.username || 'Someone';
    }

    try {
      await this.notificationsService.createOrUpdateGrouped({
        userId: authorId,
        type: 'POST_VOTE' satisfies NotificationType,
        referenceId: post._id.toHexString(),
        referenceType: 'Post',
        postId: post._id.toHexString(),
        // Omit actorId for anonymous votes so avatar/profile cannot be resolved.
        actorId: anonymous ? undefined : voterUserId,
        actorName,
        verbPhrase: 'voted on your post',
        title: 'New vote on your post',
      });
    } catch (err) {
      this.logger.warn(
        `Vote notification skipped for post ${post._id.toHexString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async getStats(postId: string, optionCount: number) {
    const rows = await this.voteModel.aggregate<{ _id: number; count: number }>(
      [
        { $match: { postId: new Types.ObjectId(postId) } },
        { $group: { _id: '$selectedOptionIndex', count: { $sum: 1 } } },
      ],
    );
    const counts = Array.from({ length: optionCount }, () => 0);
    for (const row of rows) {
      const i = row._id;
      if (i >= 0 && i < optionCount) counts[i] = row.count;
    }
    const total = counts.reduce((a, b) => a + b, 0);
    const percentages = counts.map((c) =>
      total === 0 ? 0 : Math.round((c / total) * 10000) / 100,
    );
    return { totalVotes: total, countsPerOption: counts, percentages };
  }

  async getMyVoteIndex(
    userId: string,
    postId: string,
  ): Promise<number | undefined> {
    const v = await this.voteModel
      .findOne({
        userId: new Types.ObjectId(userId),
        postId: new Types.ObjectId(postId),
      })
      .exec();
    return v?.selectedOptionIndex;
  }

  async getMyVote(
    userId: string,
    postId: string,
  ): Promise<{ selectedOptionIndex: number; anonymous: boolean } | null> {
    const v = await this.voteModel
      .findOne({
        userId: new Types.ObjectId(userId),
        postId: new Types.ObjectId(postId),
      })
      .exec();
    if (!v) return null;
    return {
      selectedOptionIndex: v.selectedOptionIndex,
      anonymous: !!v.anonymous,
    };
  }

  async vote(
    userId: string,
    postId: string,
    selectedOptionIndex: number,
    anonymous = false,
  ) {
    if (!Types.ObjectId.isValid(postId)) {
      throw new BadRequestException('Invalid post id');
    }
    const post = await this.postModel.findById(postId).exec();
    if (!post) throw new NotFoundException('Post not found');
    if (post.votingEndsAt && post.votingEndsAt.getTime() <= Date.now()) {
      throw new BadRequestException('Voting period has ended for this post');
    }
    if (selectedOptionIndex < 0 || selectedOptionIndex >= post.options.length) {
      throw new BadRequestException('Invalid option');
    }

    // Friendship gate: USER and ORG posts require mutual friendship with the author
    if (
      post.type !== PostType.SYSTEM &&
      post.createdBy.toHexString() !== userId
    ) {
      const vid = new Types.ObjectId(userId);
      const aid = post.createdBy;
      const [v2a, a2v] = await Promise.all([
        this.followModel.countDocuments({
          followerId: vid,
          followingId: aid,
          status: FollowStatus.ACCEPTED,
        }),
        this.followModel.countDocuments({
          followerId: aid,
          followingId: vid,
          status: FollowStatus.ACCEPTED,
        }),
      ]);
      if (!v2a || !a2v) {
        throw new ForbiddenException(
          'You must be friends with the post author to vote',
        );
      }
    }
    const uid = new Types.ObjectId(userId);
    const pid = new Types.ObjectId(postId);
    const existing = await this.voteModel
      .findOne({
        userId: uid,
        postId: pid,
      })
      .exec();
    const isNewVote = !existing;
    if (isNewVote) {
      await this.voteModel.create({
        userId: uid,
        postId: pid,
        selectedOptionIndex,
        anonymous,
      });
      await this.postModel.updateOne({ _id: pid }, { $inc: { voteCount: 1 } });
      void this.notifyPostAuthorOfVote(post, userId, anonymous);
    } else if (existing.selectedOptionIndex !== selectedOptionIndex) {
      existing.selectedOptionIndex = selectedOptionIndex;
      existing.anonymous = anonymous;
      await existing.save();
    } else if (existing.anonymous !== anonymous) {
      existing.anonymous = anonymous;
      await existing.save();
    }
    const stats = await this.getStats(postId, post.options.length);
    await pubsub.publish(VOTE_UPDATED, {
      voteUpdated: { postId, ...stats },
    });
    await pubsub.publish(POST_VOTE_UPDATED, {
      postVoteUpdated: { postId },
    });
    return {
      postId,
      totalVotes: stats.totalVotes,
      countsPerOption: stats.countsPerOption,
      percentages: stats.percentages,
    };
  }

  /**
   * Post ids the user has voted on, newest-first. `anonymousOnly` restricts to
   * votes the user cast anonymously. One vote per (user, post), so ids are unique.
   */
  async listVotedPostIds(
    userId: string,
    anonymousOnly = false,
  ): Promise<Types.ObjectId[]> {
    if (!Types.ObjectId.isValid(userId)) return [];
    const query: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };
    if (anonymousOnly) query.anonymous = true;
    const votes = await this.voteModel
      .find(query, { postId: 1 })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
    return votes.map((v) => v.postId as Types.ObjectId);
  }

  /** Remove the current user's vote on a post (withdraw). No-op if not voted. */
  async removeVote(userId: string, postId: string) {
    if (!Types.ObjectId.isValid(postId)) {
      throw new BadRequestException('Invalid post id');
    }
    const post = await this.postModel.findById(postId).exec();
    if (!post) throw new NotFoundException('Post not found');
    if (post.votingEndsAt && post.votingEndsAt.getTime() <= Date.now()) {
      throw new BadRequestException('Voting period has ended for this post');
    }
    const uid = new Types.ObjectId(userId);
    const pid = new Types.ObjectId(postId);
    const existing = await this.voteModel
      .findOne({ userId: uid, postId: pid })
      .exec();
    if (existing) {
      await this.voteModel.deleteOne({ _id: existing._id });
      await this.postModel.updateOne(
        { _id: pid, voteCount: { $gt: 0 } },
        { $inc: { voteCount: -1 } },
      );
    }
    const stats = await this.getStats(postId, post.options.length);
    await pubsub.publish(VOTE_UPDATED, {
      voteUpdated: { postId, ...stats },
    });
    await pubsub.publish(POST_VOTE_UPDATED, {
      postVoteUpdated: { postId },
    });
    return {
      postId,
      totalVotes: stats.totalVotes,
      countsPerOption: stats.countsPerOption,
      percentages: stats.percentages,
    };
  }

  async listVoters(
    postId: string,
    optionIndex?: number,
    search?: string,
    skip = 0,
    take?: number,
  ): Promise<PostVoterGql[]> {
    const query: Record<string, unknown> = {
      postId: new Types.ObjectId(postId),
    };
    if (optionIndex !== undefined) {
      query.selectedOptionIndex = optionIndex;
    }
    // Server-side name search: resolve matching user ids first and restrict the
    // vote query to them. Anonymous votes have no name so they are excluded
    // while searching. Keeps large voter lists off the client.
    const trimmedSearch = search?.trim();
    if (trimmedSearch) {
      const ids = await this.usersService.findIdsByNameSearch(trimmedSearch);
      if (ids.length === 0) return [];
      query.userId = { $in: ids };
      query.anonymous = { $ne: true };
    }
    // Pagination: skip/take let the client load voters in batches (infinite
    // scroll) instead of pulling the whole list at once.
    let cursor = this.voteModel
      .find(query)
      .sort({ updatedAt: -1 })
      .skip(Math.max(0, skip));
    if (take !== undefined && take > 0) {
      cursor = cursor.limit(take);
    }
    const rows = await cursor.exec();
    const out: PostVoterGql[] = [];
    for (const row of rows) {
      const isAnonymous = !!row.anonymous;
      const user = isAnonymous
        ? null
        : await this.usersService.findById(row.userId.toHexString());
      out.push({
        voteId: row._id.toHexString(),
        selectedOptionIndex: row.selectedOptionIndex,
        anonymous: isAnonymous,
        user: user ? this.usersService.toGql(user) : null,
        createdAt: row.createdAt ?? new Date(),
        updatedAt: row.updatedAt ?? row.createdAt ?? new Date(),
      });
    }
    return out;
  }
}
