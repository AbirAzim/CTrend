import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Follow, FollowDocument } from './follow.schema';

@Injectable()
export class FollowsService {
  constructor(
    @InjectModel(Follow.name) private followModel: Model<FollowDocument>,
  ) {}

  async follow(followerId: string, followingId: string) {
    if (followerId === followingId) return;
    const fid = new Types.ObjectId(followerId);
    const tid = new Types.ObjectId(followingId);
    await this.followModel
      .updateOne(
        { followerId: fid, followingId: tid },
        { $setOnInsert: { followerId: fid, followingId: tid } },
        { upsert: true },
      )
      .exec();
  }

  async getFollowingIds(userId: string): Promise<string[]> {
    const rows = await this.followModel
      .find({ followerId: new Types.ObjectId(userId) })
      .select('followingId')
      .lean()
      .exec();
    return rows.map((r) => r.followingId.toString());
  }

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const n = await this.followModel.countDocuments({
      followerId: new Types.ObjectId(followerId),
      followingId: new Types.ObjectId(followingId),
    });
    return n > 0;
  }
}
