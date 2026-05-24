import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Post, PostDocument } from '../posts/post.schema';
import {
  FeedScope,
  FeedSort,
  OrgPostReach,
  PostStatus,
  PostType,
} from '../common/enums';
import { PostsService } from '../posts/posts.service';
import { FollowsService } from '../follows/follows.service';
import { OrganizationsService } from '../organizations/organizations.service';

@Injectable()
export class FeedService {
  constructor(
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    private postsService: PostsService,
    private followsService: FollowsService,
    private organizationsService: OrganizationsService,
  ) {}

  async getFeed(
    scope: FeedScope,
    sort: FeedSort,
    skip: number,
    take: number,
    viewerId?: string,
    viewerRole?: string,
  ) {
    const baseFilter = await this.buildFilter(scope, viewerId, viewerRole);
    const filter = { ...baseFilter, status: { $ne: PostStatus.SCHEDULED } };
    const sortSpec = this.buildSort(sort);
    const q = this.postModel.find(filter).sort(sortSpec).skip(skip).limit(take);
    const [rows, totalCount] = await Promise.all([
      q.exec(),
      this.postModel.countDocuments(filter),
    ]);
    const nodes = await Promise.all(
      rows.map((p) => this.postsService.toGql(p, viewerId)),
    );
    return { nodes, totalCount };
  }

  private buildSort(sort: FeedSort): Record<string, 1 | -1> {
    switch (sort) {
      case FeedSort.LATEST:
        return { createdAt: -1 };
      case FeedSort.TRENDING:
        return { voteCount: -1, createdAt: -1 };
      case FeedSort.ADMIN_PRIORITY:
        return { feedPriority: -1, voteCount: -1, createdAt: -1 };
      default:
        return { createdAt: -1 };
    }
  }

  private async buildFilter(
    scope: FeedScope,
    viewerId?: string,
    viewerRole?: string,
  ): Promise<Record<string, unknown>> {
    // Admins see everything.
    if (viewerRole === 'admin') return {};

    // Normal user posts are friends-only; only SYSTEM and global ORG posts are public.
    const platformWide: Record<string, unknown>[] = [
      { type: PostType.SYSTEM },
      { type: PostType.ORG, orgReach: OrgPostReach.GLOBAL },
    ];

    if (scope === FeedScope.GLOBAL || !viewerId) {
      return { $or: platformWide };
    }

    const viewerOid = new Types.ObjectId(viewerId);
    const followingIds = await this.followsService.getFollowingIds(viewerId);
    const followingOids = followingIds.map((id) => new Types.ObjectId(id));

    const orgConnectedIds = await this.orgIdsForFollowedOwners(followingIds);

    const parts: Record<string, unknown>[] = [
      { type: PostType.SYSTEM },
      { type: PostType.USER, createdBy: viewerOid }, // own posts
    ];

    // All posts (public and private) from followed users.
    if (followingOids.length > 0) {
      parts.push({ type: PostType.USER, createdBy: { $in: followingOids } });
    }

    if (orgConnectedIds.length > 0) {
      parts.push({
        type: PostType.ORG,
        orgReach: OrgPostReach.CONNECTED,
        organizationId: { $in: orgConnectedIds },
      });
    }

    parts.push({ type: PostType.ORG, orgReach: OrgPostReach.GLOBAL });

    return { $or: parts };
  }

  private async orgIdsForFollowedOwners(
    followingUserIds: string[],
  ): Promise<Types.ObjectId[]> {
    if (!followingUserIds.length) return [];
    const ids: Types.ObjectId[] = [];
    for (const fid of followingUserIds) {
      const org = await this.organizationsService.findByOwnerUserId(fid);
      if (org) ids.push(org._id);
    }
    return ids;
  }
}
