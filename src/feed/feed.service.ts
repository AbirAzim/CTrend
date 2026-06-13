import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Post, PostDocument } from '../posts/post.schema';
import { Vote, VoteDocument } from '../votes/vote.schema';
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
    @InjectModel(Vote.name) private voteModel: Model<VoteDocument>,
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
    const [rows, totalCount] = await Promise.all([
      this.fetchRows(filter, sortSpec, skip, take, viewerId),
      this.postModel.countDocuments(filter),
    ]);
    const nodes = await Promise.all(
      rows.map((p) => this.postsService.toGql(p, viewerId)),
    );
    return { nodes, totalCount };
  }

  /**
   * On the first page (skip=0), open match-type campaign posts the viewer
   * hasn't voted on yet are pinned to the top, ordered by nearest kickoff
   * (votingEndsAt ASC). The remaining slots are filled with the normal feed
   * excluding those pinned posts. Page 2+ returns normal paginated results.
   */
  private async fetchRows(
    filter: Record<string, unknown>,
    sortSpec: Record<string, 1 | -1>,
    skip: number,
    take: number,
    viewerId?: string,
  ): Promise<PostDocument[]> {
    if (skip !== 0) {
      return this.postModel.find(filter).sort(sortSpec).skip(skip).limit(take).exec();
    }

    const now = new Date();

    // Tier 1: LIVE match posts (IN_PLAY or PAUSED) — everyone sees them first
    const liveFilter = {
      ...filter,
      matchType: true,
      fixtureStatus: { $in: ['IN_PLAY', 'PAUSED'] },
    };
    const livePosts = await this.postModel
      .find(liveFilter)
      .sort({ votingEndsAt: 1 })
      .exec();

    // Tier 2: upcoming unvoted match posts (before kickoff)
    const upcomingFilter = {
      ...filter,
      matchType: true,
      votingEndsAt: { $gt: now },
    };
    const upcomingCandidates = await this.postModel
      .find(upcomingFilter)
      .sort({ votingEndsAt: 1 })
      .exec();

    let upcomingPinned = upcomingCandidates;
    if (viewerId && upcomingCandidates.length > 0) {
      const candidateIds = upcomingCandidates.map((p) => p._id);
      const votedIds = await this.voteModel
        .find({
          userId: new Types.ObjectId(viewerId),
          postId: { $in: candidateIds },
        })
        .distinct('postId')
        .exec();
      const votedSet = new Set((votedIds as Types.ObjectId[]).map((id) => id.toString()));
      upcomingPinned = upcomingCandidates.filter(
        (p) => !votedSet.has((p._id as Types.ObjectId).toString()),
      );
    }

    const pinned = [...livePosts, ...upcomingPinned];
    const pinnedIds = pinned.map((p) => p._id);
    const regularLimit = Math.max(take - pinned.length, 0);

    const regularFilter =
      pinnedIds.length > 0
        ? { ...filter, _id: { $nin: pinnedIds } }
        : filter;

    const regular =
      regularLimit > 0
        ? await this.postModel
            .find(regularFilter)
            .sort(sortSpec)
            .limit(regularLimit)
            .exec()
        : [];

    return [...pinned, ...regular];
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
