import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Vote, VoteDocument } from './vote.schema';
import { Post, PostDocument } from '../posts/post.schema';
import { POST_VOTE_UPDATED, pubsub, VOTE_UPDATED } from '../pubsub';

@Injectable()
export class VotesService {
  constructor(
    @InjectModel(Vote.name) private voteModel: Model<VoteDocument>,
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
  ) {}

  async getStats(postId: string, optionCount: number) {
    const votes = await this.voteModel
      .find({ postId: new Types.ObjectId(postId) })
      .lean()
      .exec();
    const counts = Array.from({ length: optionCount }, () => 0);
    for (const v of votes) {
      const i = v.selectedOptionIndex;
      if (i >= 0 && i < optionCount) counts[i]++;
    }
    const total = votes.length;
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

  async vote(userId: string, postId: string, selectedOptionIndex: number) {
    const post = await this.postModel.findById(postId);
    if (!post) throw new NotFoundException('Post not found');
    if (post.votingEndsAt && post.votingEndsAt.getTime() <= Date.now()) {
      throw new BadRequestException('Voting period has ended for this post');
    }
    if (selectedOptionIndex < 0 || selectedOptionIndex >= post.options.length) {
      throw new BadRequestException('Invalid option');
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
      });
      await this.postModel.updateOne({ _id: pid }, { $inc: { voteCount: 1 } });
    } else if (existing.selectedOptionIndex !== selectedOptionIndex) {
      existing.selectedOptionIndex = selectedOptionIndex;
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
}
