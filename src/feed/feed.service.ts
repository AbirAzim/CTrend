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
} from '../common/enums';
import { PostsService } from '../posts/posts.service';
import { FollowsService } from '../follows/follows.service';
import { OrganizationsService } from '../organizations/organizations.service';

@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);
  private lastScheduledSyncAt = 0;

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
    campaignId?: string,
  ) {
    await this.syncDueScheduledPosts();
    const filter = await this.buildFilter(scope, viewerId, viewerRole, campaignId);
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

  /**
   * Backstop for scheduled publishing: if cron missed due to transient infra
   * issues (DB reconnect, process restart), feed reads still self-heal by
   * publishing overdue scheduled posts.
   */
  private async syncDueScheduledPosts(): Promise<void> {
    const now = Date.now();
    // Throttle to avoid running expensive checks on every request.
    if (now - this.lastScheduledSyncAt < 20_000) return;
    this.lastScheduledSyncAt = now;
    try {
      await this.postsService.publishScheduledPosts();
    } catch (err) {
      this.logger.warn(
        `Scheduled sync during feed read failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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
    campaignId?: string,
  ): Promise<Record<string, unknown>> {
    const notScheduled = { status: { $ne: PostStatus.SCHEDULED } };
    const campaignFilter =
      campaignId && Types.ObjectId.isValid(campaignId)
        ? { campaignId: new Types.ObjectId(campaignId) }
        : {};

    // NOTE: Admins are intentionally NOT given a feed-wide override. They see
    // the feed exactly like a normal user (own + friends' + SYSTEM + global
    // broadcasts + org). Friend-only posts of users they aren't friends with
    // are managed from the Admin dashboard ("User Normal posts" tab), not
    // surfaced in the main feed.
    void viewerRole;

    // Unauthenticated: admin SYSTEM posts + user global broadcasts only.
    if (!viewerId) {
      return {
        $or: [
          { type: PostType.SYSTEM, ...notScheduled },
          {
            type: PostType.USER,
            isUserGlobalBroadcast: true,
            ...notScheduled,
          },
        ],
        ...campaignFilter,
      };
    }

    // Authenticated user: own posts (any status) + friends' posts + SYSTEM + org posts.
    const viewerOid = new Types.ObjectId(viewerId);
    const followingIds = await this.followsService.getFollowingIds(viewerId);
    const followingOids = followingIds.map((id) => new Types.ObjectId(id));
    const orgConnectedIds = await this.orgIdsForFollowedOwners(followingIds);

    const parts: Record<string, unknown>[] = [
      { type: PostType.SYSTEM, ...notScheduled },
      {
        type: PostType.USER,
        isUserGlobalBroadcast: true,
        ...notScheduled,
      },
      // Own posts in feed exclude SCHEDULED — they live in /profile/scheduled
      { type: PostType.USER, createdBy: viewerOid, ...notScheduled },
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

    return { $or: parts, ...campaignFilter };
  }

  private async orgIdsForFollowedOwners(
    followingUserIds: string[],
  ): Promise<Types.ObjectId[]> {
    if (!followingUserIds.length) return [];
    const orgs =
      await this.organizationsService.findManyByOwnerUserIds(followingUserIds);
    return orgs.map((org) => org._id);
  }
}
