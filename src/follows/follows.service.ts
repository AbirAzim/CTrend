import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Follow, FollowDocument, FollowStatus } from './follow.schema';
import { User, UserDocument } from '../users/user.schema';
import { UsersService } from '../users/users.service';
import { UserGql } from '../users/graphql/user.types';

@Injectable()
export class FollowsService {
  constructor(
    @InjectModel(Follow.name) private followModel: Model<FollowDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private usersService: UsersService,
  ) {}

  async follow(followerId: string, followingId: string) {
    if (followerId === followingId) return;
    const fid = new Types.ObjectId(followerId);
    const tid = new Types.ObjectId(followingId);
    await this.followModel
      .updateOne(
        { followerId: fid, followingId: tid },
        {
          $setOnInsert: { followerId: fid, followingId: tid },
          $set: { status: FollowStatus.ACCEPTED },
        },
        { upsert: true },
      )
      .exec();
  }

  async getFollowingIds(userId: string): Promise<string[]> {
    const rows = await this.followModel
      .find({
        followerId: new Types.ObjectId(userId),
        status: FollowStatus.ACCEPTED,
      })
      .select('followingId')
      .lean()
      .exec();
    return rows.map((r) => r.followingId.toString());
  }

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const n = await this.followModel.countDocuments({
      followerId: new Types.ObjectId(followerId),
      followingId: new Types.ObjectId(followingId),
      status: FollowStatus.ACCEPTED,
    });
    return n > 0;
  }

  async getFollowerIds(userId: string): Promise<string[]> {
    const rows = await this.followModel
      .find({
        followingId: new Types.ObjectId(userId),
        status: FollowStatus.ACCEPTED,
      })
      .select('followerId')
      .lean()
      .exec();
    return rows.map((r) => r.followerId.toString());
  }

  async getMyFriends(userId: string): Promise<UserGql[]> {
    const [followingIds, followerIds] = await Promise.all([
      this.getFollowingIds(userId),
      this.getFollowerIds(userId),
    ]);
    const followerSet = new Set(followerIds);
    const friendIds = followingIds.filter((id) => followerSet.has(id));
    if (!friendIds.length) return [];
    const friends = await this.userModel
      .find({ _id: { $in: friendIds.map((id) => new Types.ObjectId(id)) } })
      .sort({ createdAt: -1 })
      .exec();
    return friends.map((u) => this.usersService.toGql(u));
  }

  async getFriendSuggestions(
    userId: string,
    limit: number,
  ): Promise<UserGql[]> {
    const relatedRows = await this.followModel
      .find({
        $or: [
          { followerId: new Types.ObjectId(userId) },
          { followingId: new Types.ObjectId(userId) },
        ],
      })
      .select('followerId followingId')
      .lean()
      .exec();
    const excludedIds = new Set<string>([userId]);
    for (const row of relatedRows) {
      excludedIds.add(row.followerId.toString());
      excludedIds.add(row.followingId.toString());
    }
    const candidates = await this.userModel
      .find({
        _id: {
          $nin: Array.from(excludedIds).map((id) => new Types.ObjectId(id)),
        },
        // Only show users who hold the user role.
        // Pure admin-only accounts (no user role) are excluded.
        $or: [
          { roles: 'user' }, // has user role in the array (includes dual-role)
          { roles: { $exists: false } }, // legacy docs without roles field
          { roles: { $size: 0 } }, // edge case: empty roles array
        ],
      })
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(limit, 100)))
      .exec();
    return candidates.map((u) => this.usersService.toGql(u));
  }

  async addFriendRequest(
    requesterId: string,
    targetUserId: string,
  ): Promise<string> {
    if (requesterId === targetUserId) {
      throw new BadRequestException('Cannot send friend request to yourself');
    }
    const requester = new Types.ObjectId(requesterId);
    const target = new Types.ObjectId(targetUserId);
    const existing = await this.followModel
      .findOne({ followerId: requester, followingId: target })
      .exec();
    if (existing?.status === FollowStatus.ACCEPTED) return 'accepted';

    await this.followModel
      .updateOne(
        { followerId: requester, followingId: target },
        {
          $setOnInsert: { followerId: requester, followingId: target },
          $set: { status: FollowStatus.PENDING },
        },
        { upsert: true },
      )
      .exec();
    return 'requested';
  }

  async getIncomingFriendRequests(userId: string): Promise<UserGql[]> {
    const rows = await this.followModel
      .find({
        followingId: new Types.ObjectId(userId),
        status: FollowStatus.PENDING,
      })
      .select('followerId')
      .lean()
      .exec();
    const requesterIds = rows.map((r) => r.followerId.toString());
    if (!requesterIds.length) return [];
    const users = await this.userModel
      .find({ _id: { $in: requesterIds.map((id) => new Types.ObjectId(id)) } })
      .sort({ createdAt: -1 })
      .exec();
    return users.map((u) => this.usersService.toGql(u));
  }

  async getOutgoingFriendRequests(userId: string): Promise<UserGql[]> {
    const rows = await this.followModel
      .find({
        followerId: new Types.ObjectId(userId),
        status: FollowStatus.PENDING,
      })
      .select('followingId')
      .lean()
      .exec();
    const targetIds = rows.map((r) => r.followingId.toString());
    if (!targetIds.length) return [];
    const users = await this.userModel
      .find({ _id: { $in: targetIds.map((id) => new Types.ObjectId(id)) } })
      .sort({ createdAt: -1 })
      .exec();
    return users.map((u) => this.usersService.toGql(u));
  }

  async cancelFriendRequest(
    requesterId: string,
    targetId: string,
  ): Promise<void> {
    await this.followModel
      .deleteOne({
        followerId: new Types.ObjectId(requesterId),
        followingId: new Types.ObjectId(targetId),
        status: FollowStatus.PENDING,
      })
      .exec();
  }

  async unfriend(userId: string, targetId: string): Promise<void> {
    const a = new Types.ObjectId(userId);
    const b = new Types.ObjectId(targetId);
    await this.followModel
      .deleteMany({
        $or: [
          { followerId: a, followingId: b },
          { followerId: b, followingId: a },
        ],
      })
      .exec();
  }

  async getFriendshipStatus(
    viewerId: string,
    targetId: string,
  ): Promise<'FRIEND' | 'PENDING_SENT' | 'PENDING_RECEIVED' | 'NONE'> {
    if (viewerId === targetId) return 'NONE';
    const vid = new Types.ObjectId(viewerId);
    const tid = new Types.ObjectId(targetId);
    const [v2t, t2v] = await Promise.all([
      this.followModel
        .findOne({ followerId: vid, followingId: tid })
        .lean()
        .exec(),
      this.followModel
        .findOne({ followerId: tid, followingId: vid })
        .lean()
        .exec(),
    ]);
    if (
      v2t?.status === FollowStatus.ACCEPTED &&
      t2v?.status === FollowStatus.ACCEPTED
    )
      return 'FRIEND';
    if (v2t?.status === FollowStatus.PENDING) return 'PENDING_SENT';
    if (t2v?.status === FollowStatus.PENDING) return 'PENDING_RECEIVED';
    return 'NONE';
  }

  async respondToFriendRequest(
    userId: string,
    requesterId: string,
    accept: boolean,
  ): Promise<void> {
    const requester = new Types.ObjectId(requesterId);
    const current = new Types.ObjectId(userId);
    const req = await this.followModel
      .findOne({
        followerId: requester,
        followingId: current,
        status: FollowStatus.PENDING,
      })
      .exec();
    if (!req) throw new BadRequestException('Friend request not found');

    if (!accept) {
      await this.followModel.deleteOne({ _id: req._id }).exec();
      return;
    }

    req.status = FollowStatus.ACCEPTED;
    await req.save();
    await this.followModel
      .updateOne(
        { followerId: current, followingId: requester },
        {
          $setOnInsert: { followerId: current, followingId: requester },
          $set: { status: FollowStatus.ACCEPTED },
        },
        { upsert: true },
      )
      .exec();
  }
}
