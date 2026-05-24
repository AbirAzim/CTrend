import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Post, PostDocument } from '../posts/post.schema';
import {
  FeedScope,
  FeedSort,
  OrgPostReach,
  PostStatus,
  PostType,
  UserRole,
} from '../common/enums';
import { PostsService } from '../posts/posts.service';
import { FollowsService } from '../follows/follows.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);

  constructor(
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    private postsService: PostsService,
    private followsService: FollowsService,
    private organizationsService: OrganizationsService,
    private usersService: UsersService,
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
    this.logger.log(
      `[DEBUG] getFeed viewerId=${viewerId} viewerRole=${viewerRole} filter=${JSON.stringify(baseFilter)}`,
    );
    const filter = baseFilter;
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
    _scope: FeedScope,
    viewerId?: string,
    viewerRole?: string,
  ): Promise<Record<string, unknown>> {
    // Admins see every post on the platform.
    if (viewerRole === 'admin') return {};

    const notScheduled = { status: { $ne: PostStatus.SCHEDULED } };

    // Unauthenticated: SYSTEM posts and posts created by admin users only.
    if (!viewerId) {
      const adminIds = await this.usersService.findIdsByRole(UserRole.ADMIN);
      const parts: Record<string, unknown>[] = [
        { type: PostType.SYSTEM, ...notScheduled },
      ];
      if (adminIds.length > 0) {
        parts.push({ createdBy: { $in: adminIds }, ...notScheduled });
      }
      return { $or: parts };
    }

    // Authenticated user: own posts (any status) + friends' posts + SYSTEM + org posts.
    const viewerOid = new Types.ObjectId(viewerId);
    const ownCount = await this.postModel.countDocuments({
      type: PostType.USER,
      createdBy: viewerOid,
    });
    this.logger.log(
      `[DEBUG] viewerOid=${viewerOid} own USER posts in DB: ${ownCount}`,
    );
    const followingIds = await this.followsService.getFollowingIds(viewerId);
    const followingOids = followingIds.map((id) => new Types.ObjectId(id));
    const orgConnectedIds = await this.orgIdsForFollowedOwners(followingIds);

    const parts: Record<string, unknown>[] = [
      { type: PostType.SYSTEM, ...notScheduled },
      { type: PostType.USER, createdBy: viewerOid }, // own posts: no status restriction
    ];

    if (followingOids.length > 0) {
      parts.push({
        type: PostType.USER,
        createdBy: { $in: followingOids },
        ...notScheduled,
      });
    }

    if (orgConnectedIds.length > 0) {
      parts.push({
        type: PostType.ORG,
        orgReach: OrgPostReach.CONNECTED,
        organizationId: { $in: orgConnectedIds },
        ...notScheduled,
      });
    }

    parts.push({
      type: PostType.ORG,
      orgReach: OrgPostReach.GLOBAL,
      ...notScheduled,
    });

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
