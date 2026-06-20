import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Post, PostDocument } from '../posts/post.schema';
import {
  FeedPostFilter,
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
    postFilter?: FeedPostFilter,
  ) {
    await this.syncDueScheduledPosts();
    const filter = await this.buildFilter(scope, viewerId, viewerRole, campaignId, postFilter);
    const sortSpec = this.buildSort(sort);
    const [rows, totalCount] = await Promise.all([
      this.fetchRows(filter, sort, sortSpec, skip, take),
      this.postModel.countDocuments(filter),
    ]);
    const nodes = await Promise.all(
      rows.map((p) => this.postsService.toGql(p, viewerId)),
    );
    return { nodes, totalCount };
  }

  /**
   * Fetch feed rows with a computed sort score so pagination stays consistent
   * across all pages.
   *
   * For LATEST sort, posts are tiered by a virtual _score field:
   *   Tier 0 – LIVE matches (IN_PLAY/PAUSED, or just past kickoff and not yet
   *            synced/finished — see the 10-min grace window below):  ~30.75T  (nearest kickoff first)
   *   Tier 1 – UPCOMING matches (votingEndsAt > now):  ~2.25T  (nearest kickoff first)
   *   Tier 2 – FINISHED, in reveal window (fixtureWinnerAt > now-5min): ~6.25T (pinned above upcoming)
   *   Tier 3 – All other FINISHED matches:             ~1.75T  (most recent match first)
   *   Tier 4 – Regular posts:                          ~1.75T  (createdAt descending)
   *
   * Ranges don't overlap for typical post dates, so skip-based pagination is
   * safe on every page — no hybrid pinning that would shift offsets.
   *
   * TRENDING / ADMIN_PRIORITY use simple find+sort (no tiering needed).
   */
  private async fetchRows(
    filter: Record<string, unknown>,
    sort: FeedSort,
    sortSpec: Record<string, 1 | -1>,
    skip: number,
    take: number,
  ): Promise<PostDocument[]> {
    if (sort !== FeedSort.LATEST) {
      return this.postModel.find(filter).sort(sortSpec).skip(skip).limit(take).exec();
    }

    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    // Kickoff-to-sync grace window: fixtureStatus only flips TIMED -> IN_PLAY on
    // the once-a-minute sync cron, so a match can sit a few minutes past its
    // votingEndsAt cutoff while still reporting TIMED. Without this, the post
    // falls out of both the live and upcoming tiers during that gap and sinks
    // to the regular-post tier. Treat "just past kickoff, not yet synced live,
    // not finished" the same as confirmed-live so it never drops out.
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
    // Year 3000 in ms — live matches float here (unreachable by any real createdAt)
    const LIVE_BASE_MS = 32503680000000;
    // Year 2253 in ms — revealing matches float here (below live, above upcoming)
    const REVEAL_BASE_MS = 8000000000000;
    // Year 2096 in ms — upcoming matches float here (above any real createdAt)
    const UPCOMING_BASE_MS = 4000000000000;

    const docs = await this.postModel
      .aggregate([
        { $match: filter },
        {
          $addFields: {
            _score: {
              $switch: {
                branches: [
                  {
                    // Tier 0: live matches — nearest kickoff first. Also covers the
                    // post-kickoff grace window (votingEndsAt just passed, sync cron
                    // hasn't flipped fixtureStatus to IN_PLAY yet) so the post never
                    // dips out of the feed between kickoff and the next sync tick.
                    case: {
                      $and: [
                        { $eq: ['$matchType', true] },
                        {
                          $or: [
                            { $in: ['$fixtureStatus', ['IN_PLAY', 'PAUSED']] },
                            {
                              $and: [
                                { $lte: ['$votingEndsAt', now] },
                                { $gt: ['$votingEndsAt', tenMinutesAgo] },
                                {
                                  $not: [
                                    { $eq: ['$fixtureStatus', 'FINISHED'] },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    then: {
                      $subtract: [
                        LIVE_BASE_MS,
                        { $toLong: { $ifNull: ['$votingEndsAt', now] } },
                      ],
                    },
                  },
                  {
                    // Tier 1: upcoming votable matches — nearest kickoff first
                    case: {
                      $and: [
                        { $eq: ['$matchType', true] },
                        { $gt: ['$votingEndsAt', now] },
                      ],
                    },
                    then: {
                      $subtract: [
                        UPCOMING_BASE_MS,
                        { $toLong: '$votingEndsAt' },
                      ],
                    },
                  },
                  {
                    // Tier 2: finished matches within reveal window (fixtureWinnerAt > now-5min)
                    // — stays pinned above upcoming matches until 5 min after winner is announced
                    case: {
                      $and: [
                        { $eq: ['$matchType', true] },
                        { $eq: ['$fixtureStatus', 'FINISHED'] },
                        { $gt: ['$fixtureWinnerAt', fiveMinutesAgo] },
                      ],
                    },
                    then: {
                      $subtract: [
                        REVEAL_BASE_MS,
                        { $toLong: { $ifNull: ['$fixtureWinnerAt', now] } },
                      ],
                    },
                  },
                  {
                    // Tier 3: all other finished matches — order by match time descending
                    case: {
                      $and: [
                        { $eq: ['$matchType', true] },
                        { $eq: ['$fixtureStatus', 'FINISHED'] },
                      ],
                    },
                    then: { $toLong: { $ifNull: ['$votingEndsAt', '$createdAt'] } },
                  },
                ],
                // Tier 3: regular posts — natural recency by createdAt
                default: { $toLong: '$createdAt' },
              },
            },
          },
        },
        { $sort: { _score: -1 } },
        { $skip: skip },
        { $limit: take },
        { $project: { _score: 0 } },
      ])
      .exec();

    return docs as unknown as PostDocument[];
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
    postFilter?: FeedPostFilter,
  ): Promise<Record<string, unknown>> {
    const notScheduled = { status: { $ne: PostStatus.SCHEDULED } };
    const campaignFilter =
      campaignId && Types.ObjectId.isValid(campaignId)
        ? { campaignId: new Types.ObjectId(campaignId) }
        : {};

    void viewerRole;

    // When a specific post-type filter is active, short-circuit with a simple
    // DB query rather than the full fan-out $or — faster and paginates correctly.
    if (postFilter && postFilter !== FeedPostFilter.ALL) {
      switch (postFilter) {
        case FeedPostFilter.CAMPAIGN:
          // Admin SYSTEM posts that have a campaign attached
          return {
            type: PostType.SYSTEM,
            campaignId: { $exists: true, $ne: null },
            ...notScheduled,
            ...campaignFilter,
          };
        case FeedPostFilter.PLATFORM:
          // Admin SYSTEM posts with no campaign (pure platform posts)
          return {
            type: PostType.SYSTEM,
            $or: [
              { campaignId: { $exists: false } },
              { campaignId: null },
            ],
            ...notScheduled,
          };
        case FeedPostFilter.COMMUNITY: {
          // Global broadcasts + own posts + friends' posts (all USER-type content).
          // Unauthenticated viewers see only global broadcasts.
          if (!viewerId) {
            return { type: PostType.USER, isUserGlobalBroadcast: true, ...notScheduled };
          }
          const viewerOidC = new Types.ObjectId(viewerId);
          const followingIdsC = await this.followsService.getFollowingIds(viewerId);
          const followingOidsC = followingIdsC.map((id) => new Types.ObjectId(id));
          const communityParts: Record<string, unknown>[] = [
            { type: PostType.USER, isUserGlobalBroadcast: true, ...notScheduled },
            { type: PostType.USER, createdBy: viewerOidC, ...notScheduled },
          ];
          if (followingOidsC.length > 0) {
            communityParts.push({
              type: PostType.USER,
              createdBy: { $in: followingOidsC },
              ...notScheduled,
            });
          }
          return { $or: communityParts };
        }
        case FeedPostFilter.FRIEND: {
          // Friend/following posts — need to know who the viewer follows
          if (!viewerId) return { _id: null }; // unauthenticated: empty result
          const viewerOid = new Types.ObjectId(viewerId);
          const followingIds = await this.followsService.getFollowingIds(viewerId);
          const followingOids = followingIds.map((id) => new Types.ObjectId(id));
          const friendParts: Record<string, unknown>[] = [
            {
              type: PostType.USER,
              isUserGlobalBroadcast: { $ne: true },
              createdBy: viewerOid,
              ...notScheduled,
            },
          ];
          if (followingOids.length > 0) {
            friendParts.push({
              type: PostType.USER,
              isUserGlobalBroadcast: { $ne: true },
              createdBy: { $in: followingOids },
              ...notScheduled,
            });
          }
          return { $or: friendParts };
        }
      }
    }

    // Default: full feed — all visible post types.

    // Unauthenticated: admin SYSTEM posts + user global broadcasts only.
    if (!viewerId) {
      return {
        $or: [
          { type: PostType.SYSTEM, ...notScheduled },
          { type: PostType.USER, isUserGlobalBroadcast: true, ...notScheduled },
        ],
        ...campaignFilter,
      };
    }

    // Authenticated user: own + friends' + SYSTEM + global broadcasts + org posts.
    const viewerOid = new Types.ObjectId(viewerId);
    const followingIds = await this.followsService.getFollowingIds(viewerId);
    const followingOids = followingIds.map((id) => new Types.ObjectId(id));
    const orgConnectedIds = await this.orgIdsForFollowedOwners(followingIds);

    const parts: Record<string, unknown>[] = [
      { type: PostType.SYSTEM, ...notScheduled },
      { type: PostType.USER, isUserGlobalBroadcast: true, ...notScheduled },
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

    parts.push({ type: PostType.ORG, orgReach: OrgPostReach.GLOBAL, ...notScheduled });

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
