import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Vote, VoteDocument } from './vote.schema';
import { Post, PostDocument } from '../posts/post.schema';
import { Follow, FollowDocument, FollowStatus } from '../follows/follow.schema';
import { POST_VOTE_UPDATED, pubsub, VOTE_UPDATED } from '../pubsub';
import { UsersService } from '../users/users.service';
import { PostType } from '../common/enums';
import { PostVoterGql } from './graphql/vote.types';

@Injectable()
export class VotesService {
  constructor(
    @InjectModel(Vote.name) private voteModel: Model<VoteDocument>,
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    @InjectModel(Follow.name) private followModel: Model<FollowDocument>,
    private usersService: UsersService,
  ) {}

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
    const post = await this.postModel.findById(postId);
    if (!post) throw new NotFoundException('Post not found');
    if (post.votingEndsAt && post.votingEndsAt.getTime() <= Date.now()) {
      throw new BadRequestException('Voting period has ended for this post');
    }
    if (selectedOptionIndex < 0 || selectedOptionIndex >= post.options.length) {
      throw new BadRequestException('Invalid option');
    }

    // Friendship gate: USER and ORG posts require mutual friendship with the author
    if (post.type !== PostType.SYSTEM && post.createdBy.toString() !== userId) {
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
    const existing = await this.voteModel.findOne({
      userId: uid,
      postId: pid,
    });
    if (!existing) {
      await this.voteModel.create({
        userId: uid,
        postId: pid,
        selectedOptionIndex,
        anonymous,
      });
      await this.postModel.updateOne({ _id: pid }, { $inc: { voteCount: 1 } });
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

  async listVoters(
    postId: string,
    optionIndex?: number,
  ): Promise<PostVoterGql[]> {
    const query: Record<string, unknown> = {
      postId: new Types.ObjectId(postId),
    };
    if (optionIndex !== undefined) {
      query.selectedOptionIndex = optionIndex;
    }
    const rows = await this.voteModel
      .find(query)
      .sort({ updatedAt: -1 })
      .exec();
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
