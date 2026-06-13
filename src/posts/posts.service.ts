import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Post, PostDocument, PostOption } from './post.schema';
import {
  PostReaction,
  PostReactionDocument,
  PostReactionKind,
} from './post-reaction.schema';
import { SavedPost, SavedPostDocument } from './saved-post.schema';
import { CreatePostInput, PostOptionInput } from './dto/create-post.input';
import { UpdatePostInput } from './dto/update-post.input';
import {
  OrgPostReach,
  PostFormat,
  PostStatus,
  PostType,
  UserRole,
  Visibility,
  SubscriptionPlan,
} from '../common/enums';
import { CategoriesService } from '../categories/categories.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { UsersService } from '../users/users.service';
import { VotesService } from '../votes/votes.service';
import { CategoryDocument } from '../categories/category.schema';
import { UserDocument } from '../users/user.schema';
import { PostGql } from './graphql/post.types';
import { PostCampaignSummaryGql } from './graphql/post-campaign-summary.types';
import { PostVoteWinnerGql } from './graphql/post-vote-winner.types';
import { UserGql } from '../users/graphql/user.types';
import { CampaignsService } from '../campaigns/campaigns.service';
import { CampaignDocument } from '../campaigns/campaign.schema';
import {
  NEW_POST,
  POST_DELETED,
  POST_UPDATED,
  POST_VOTE_UPDATED,
  pubsub,
} from '../pubsub';
import { Comment, CommentDocument } from '../comments/comment.schema';
import { CommentsService } from '../comments/comments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FollowsService } from '../follows/follows.service';
import { OnModuleInit } from '@nestjs/common';
import {
  PLATFORM_BRAND_NAME,
  PLATFORM_BRAND_USERNAME,
} from '../common/platform-brand';
import { NotificationType } from '../notifications/notification.schema';
import { MessagesService } from '../messages/messages.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { ContentReportsService } from '../content-reports/content-reports.service';
import { WorldCupCampaignService } from '../world-cup-campaign/world-cup-campaign.service';

const PREMIUM_GLOBAL_MONTHLY = 20;
const DEFAULT_ENDING_SOON_LEAD_MINUTES = 5;

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class PostsService implements OnModuleInit {
  private readonly logger = new Logger(PostsService.name);
  private async safePubsubPublish(
    topic: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await pubsub.publish(topic, payload);
    } catch (err) {
      this.logger.warn(
        `PubSub publish failed for ${topic}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async onModuleInit() {
    // Backfill: re-enable hype on existing system/admin posts that were
    // created with likesDisabled=true. New posts always start with hype enabled.
    try {
      await this.postModel
        .updateMany({ likesDisabled: true }, { $set: { likesDisabled: false } })
        .exec();
    } catch {
      // non-fatal
    }
  }

  constructor(
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    @InjectModel(PostReaction.name)
    private postReactionModel: Model<PostReactionDocument>,
    @InjectModel(SavedPost.name)
    private savedPostModel: Model<SavedPostDocument>,
    @InjectModel(Comment.name)
    private commentModel: Model<CommentDocument>,
    private categoriesService: CategoriesService,
    private organizationsService: OrganizationsService,
    private usersService: UsersService,
    private votesService: VotesService,
    private commentsService: CommentsService,
    private notificationsService: NotificationsService,
    private followsService: FollowsService,
    private campaignsService: CampaignsService,
    private messagesService: MessagesService,
    private platformSettingsService: PlatformSettingsService,
    private contentReportsService: ContentReportsService,
    private worldCupCampaignService: WorldCupCampaignService,
  ) {}

  private async resolveCampaignId(
    campaignId?: string,
    callerId?: string,
    callerRole?: string,
  ): Promise<Types.ObjectId | undefined> {
    const raw = campaignId?.trim();
    if (!raw) return undefined;
    const campaign = await this.campaignsService.findById(raw);
    if (!campaign) {
      throw new BadRequestException('Invalid campaign');
    }
    // Private campaigns can only be tagged by admins
    if (!campaign.isPublic && callerRole !== 'admin') {
      throw new ForbiddenException(
        'Only admins can tag posts to private campaigns',
      );
    }
    return campaign._id;
  }

  private toCampaignSummary(doc: CampaignDocument): PostCampaignSummaryGql {
    return {
      id: doc._id.toHexString(),
      name: doc.name,
      slug: doc.slug,
      bannerText: doc.bannerText,
      bannerImageUrl: doc.bannerImageUrl,
      prizePerWinner: doc.prizePerWinner,
      hasWinner: doc.hasWinner ?? false,
      hasRewards: doc.hasRewards ?? false,
    };
  }

  private clampFocal(value: number | undefined): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (!Number.isFinite(value)) return undefined;
    return Math.min(100, Math.max(0, Math.round(value)));
  }

  /**
   * Per-format input validation. Compare posts need at least two compare
   * images (one per option); poll posts only need two option labels — option
   * images are optional and `imageUrls` holds optional body/context images.
   */
  private validateFormatInput(
    format: PostFormat,
    input: CreatePostInput,
  ): void {
    if (format === PostFormat.ANNOUNCEMENT) return; // no options/images required
    const options = input.options ?? [];
    if (options.length < 2) {
      throw new BadRequestException('A post needs at least two options.');
    }
    if (format === PostFormat.COMPARE) {
      const images = (input.imageUrls ?? []).filter(
        (u) => typeof u === 'string' && u.trim().length > 0,
      );
      if (images.length < 2) {
        throw new BadRequestException(
          'A compare post needs at least two images.',
        );
      }
    }
  }

  private mapOptionInput(o: PostOptionInput): PostOption {
    const imageFocalX = this.clampFocal(o.imageFocalX);
    const imageFocalY = this.clampFocal(o.imageFocalY);
    return {
      label: o.label,
      imageUrl: o.imageUrl,
      ...(imageFocalX !== undefined ? { imageFocalX } : {}),
      ...(imageFocalY !== undefined ? { imageFocalY } : {}),
    };
  }

  /** Winning option index(es) by vote count; all tied-at-max if draw. */
  private winningOptionIndices(counts: number[]): number[] {
    const max = counts.length ? Math.max(...counts) : 0;
    if (max <= 0) return [];
    return counts
      .map((count, index) => (count === max ? index : -1))
      .filter((index) => index >= 0);
  }

  /** Pick and persist vote giveaway winner once voting has closed (atomic — safe under parallel toGql). */
  private async ensureVoteWinnerDrawn(
    post: PostDocument,
    countsPerOption: number[],
  ): Promise<PostDocument> {
    // Match-type posts (fixture-linked): winner is determined by the real match
    // result via WinnerAnnouncementService, not by a random draw at kickoff.
    if (post.matchType) return post;

    const now = Date.now();
    const votingClosed =
      !!post.votingEndsAt && post.votingEndsAt.getTime() <= now;
    if (!votingClosed) {
      return post;
    }

    const postId = post._id;
    if (post.voteWinnerPickedAt) {
      return post;
    }

    const existing = await this.postModel.findById(postId).lean().exec();
    if (!existing || existing.voteWinnerPickedAt) {
      if (existing) {
        return (await this.postModel.findById(postId).exec()) ?? post;
      }
      return post;
    }

    const totalVotes = countsPerOption.reduce((a, b) => a + b, 0);
    const pickedAt = new Date();
    const $set: Record<string, unknown> = { voteWinnerPickedAt: pickedAt };

    if (totalVotes > 0) {
      const indices = this.winningOptionIndices(countsPerOption);
      const drawn = await this.votesService.drawRandomEligibleVoter(
        postId.toHexString(),
        indices,
      );
      if (drawn) {
        $set.voteWinnerUserId = drawn.userId;
        $set.voteWinnerOptionIndex = drawn.selectedOptionIndex;
      }
    }

    const updated = await this.postModel
      .findOneAndUpdate(
        {
          _id: postId,
          $or: [
            { voteWinnerPickedAt: { $exists: false } },
            { voteWinnerPickedAt: null },
          ],
        },
        { $set },
        { new: true },
      )
      .exec();

    if (updated) {
      if (!updated.voteEndedNotifiedAt) {
        void this.notifyVoteEndedAndWinner(updated).catch((err) =>
          this.logger.warn(
            `Vote-ended notification fanout failed for ${updated._id.toHexString()}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
      }
      return updated;
    }

    return (await this.postModel.findById(postId).exec()) ?? post;
  }

  private isFriendPost(post: PostDocument): boolean {
    return post.type === PostType.USER;
  }

  /**
   * Whether `viewer` may see `post` outside the feed (direct link / profile).
   * Mirrors the feed visibility rules in `FeedService.buildFilter`:
   * - admins see everything;
   * - SYSTEM posts, USER global broadcasts and ORG GLOBAL posts: everyone;
   * - the author always sees their own post;
   * - non-global USER ("friend") posts: only the author's friends
   *   (`isFollowing(viewer, author)` — friendship is mutual, so this matches
   *   the feed's following-based filter);
   * - ORG CONNECTED posts: viewers who follow the org owner.
   * SCHEDULED gating is handled separately by callers.
   */
  async canViewPost(
    post: PostDocument,
    viewerId?: string,
    viewerRole?: string,
  ): Promise<boolean> {
    if (viewerRole === UserRole.ADMIN) return true;
    if (post.type === PostType.SYSTEM) return true;
    if (post.type === PostType.USER && post.isUserGlobalBroadcast === true) {
      return true;
    }
    if (post.type === PostType.ORG && post.orgReach === OrgPostReach.GLOBAL) {
      return true;
    }
    if (!viewerId) return false;

    const authorId = post.createdBy.toHexString();
    if (authorId === viewerId) return true;

    if (post.type === PostType.USER) {
      // Friend post — visible only to the author's friends.
      return this.followsService.isFollowing(viewerId, authorId);
    }

    if (
      post.type === PostType.ORG &&
      post.orgReach === OrgPostReach.CONNECTED
    ) {
      const org = post.organizationId
        ? await this.organizationsService.findById(
            post.organizationId.toHexString(),
          )
        : null;
      const ownerId = org?.ownerUserId?.toHexString();
      if (!ownerId) return false;
      if (ownerId === viewerId) return true;
      return this.followsService.isFollowing(viewerId, ownerId);
    }

    return false;
  }

  /**
   * A user's posts that `viewer` is allowed to see (for profile pages). Applies
   * the same visibility rules as {@link canViewPost} but as a single Mongo query
   * so a profile load stays one round-trip. Excludes SCHEDULED posts.
   */
  async findViewableByAuthor(
    authorId: string,
    viewerId?: string,
    viewerRole?: string,
    limit = 50,
  ): Promise<PostDocument[]> {
    if (!Types.ObjectId.isValid(authorId)) return [];
    const authorOid = new Types.ObjectId(authorId);
    const notScheduled = { status: { $ne: PostStatus.SCHEDULED } };

    // Admin or the author themselves: all of this author's non-scheduled posts.
    if (viewerRole === UserRole.ADMIN || viewerId === authorId) {
      return this.postModel
        .find({ createdBy: authorOid, ...notScheduled })
        .sort({ createdAt: -1 })
        .limit(limit)
        .exec();
    }

    // Always-public posts by this author.
    const visibleOr: Record<string, unknown>[] = [
      { type: PostType.SYSTEM },
      { type: PostType.USER, isUserGlobalBroadcast: true },
      { type: PostType.ORG, orgReach: OrgPostReach.GLOBAL },
    ];

    // Friends also see this author's friend posts (and their connected org
    // posts — the author is the org owner here, so following them grants reach).
    const isFriend = viewerId
      ? await this.followsService.isFollowing(viewerId, authorId)
      : false;
    if (isFriend) {
      visibleOr.push({ type: PostType.USER });
      visibleOr.push({ type: PostType.ORG, orgReach: OrgPostReach.CONNECTED });
    }

    return this.postModel
      .find({ createdBy: authorOid, $or: visibleOr, ...notScheduled })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  private isPrizeClaimEligiblePost(post: PostDocument): boolean {
    return post.type === PostType.USER || post.type === PostType.SYSTEM;
  }

  private async notifyVoteEndedAndWinner(post: PostDocument): Promise<void> {
    if (post.voteEndedNotifiedAt) return;
    if (!post.voteWinnerPickedAt) return;

    const postId = post._id.toHexString();
    const authorId = post.createdBy.toHexString();
    const participantIds =
      await this.votesService.listParticipantUserIds(postId);
    const winnerId = post.voteWinnerUserId?.toHexString() ?? null;
    const canClaimPrize = this.isPrizeClaimEligiblePost(post);
    const recipients = new Set<string>([authorId, ...participantIds]);

    if (winnerId) {
      recipients.delete(winnerId);
    }

    await Promise.all([
      ...[...recipients].map((userId) =>
        this.notificationsService.create({
          userId,
          type: 'VOTE_ENDED' as NotificationType,
          title: 'Vote has ended',
          body: 'Vote has ended. Check out the winner.',
          referenceId: postId,
          referenceType: 'Post',
          postId,
        }),
      ),
      ...(winnerId
        ? [
            this.notificationsService.create({
              userId: winnerId,
              type: 'VOTE_WINNER' as NotificationType,
              title: canClaimPrize
                ? 'You won this post! Claim your prize'
                : 'You won this post!',
              body: canClaimPrize
                ? 'You won this post. Claim your prize now and celebrate your win.'
                : 'You won this post. Check the result and celebrate your win.',
              referenceId: postId,
              referenceType: 'Post',
              postId,
            }),
          ]
        : []),
    ]);

    await this.postModel.updateOne(
      { _id: post._id, voteEndedNotifiedAt: { $exists: false } },
      { $set: { voteEndedNotifiedAt: new Date() } },
    );
  }

  async claimVotePrize(userId: string, postId: string): Promise<PostDocument> {
    const post = await this.postModel.findById(postId).exec();
    if (!post) throw new NotFoundException('Post not found');
    if (!this.isPrizeClaimEligiblePost(post)) {
      throw new BadRequestException(
        'Prize claim is available only for friend or platform posts',
      );
    }
    if (!post.voteWinnerPickedAt || !post.voteWinnerUserId) {
      throw new BadRequestException('Winner is not available yet');
    }
    if (post.voteWinnerUserId.toHexString() !== userId) {
      throw new ForbiddenException('Only the selected winner can claim prize');
    }
    if (post.votePrizeClaimedAt) {
      return post;
    }

    const now = new Date();
    post.votePrizeClaimedAt = now;
    post.votePrizeClaimedByUserId = new Types.ObjectId(userId);
    await post.save();

    const adminIds = (
      await this.usersService.findIdsByRole(UserRole.ADMIN)
    ).map((id) => id.toHexString());
    const winner = await this.usersService.findById(userId);
    const winnerName =
      winner?.displayName?.trim() || winner?.username || 'A winner';
    const shortPostId = post._id.toHexString().slice(-8);

    await Promise.all(
      adminIds.map((adminId) =>
        this.notificationsService.create({
          userId: adminId,
          type: 'VOTE_PRIZE_CLAIMED' as NotificationType,
          title: 'Winner claimed prize',
          body: `${winnerName} is claiming prize for post #${shortPostId}.`,
          referenceId: post._id.toHexString(),
          referenceType: 'Post',
          postId: post._id.toHexString(),
          actorId: userId,
          actorName: winnerName,
        }),
      ),
    );

    await this.messagesService.sendSystemModeratorAutoMessage(
      userId,
      'Your prize claim is received. A moderator will connect with you soon.',
    );

    return post;
  }

  async findById(id: string): Promise<PostDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.postModel.findById(id).exec();
  }

  /**
   * Platform-wide posts for admin management — search, filter, sort.
   * `scope` selects admin SYSTEM posts (default) or user global broadcasts.
   */
  async listPlatformPostsAdmin(query: {
    search?: string;
    status?: PostStatus;
    categoryId?: string;
    votingFilter?: string;
    sortBy?: string;
    sortOrder?: string;
    scope?: string;
    skip?: number;
    take?: number;
  }): Promise<PostDocument[]> {
    const safeTake = Math.min(100, Math.max(1, query.take ?? 50));
    return this.postModel
      .find(this.buildPlatformPostsFilter(query))
      .sort(this.platformPostsSort(query))
      .skip(Math.max(0, query.skip ?? 0))
      .limit(safeTake)
      .exec();
  }

  async countPlatformPostsAdmin(query: {
    search?: string;
    status?: PostStatus;
    categoryId?: string;
    votingFilter?: string;
    scope?: string;
  }): Promise<number> {
    return this.postModel
      .countDocuments(this.buildPlatformPostsFilter(query))
      .exec();
  }

  /** Posts with one or more user content reports — admin moderation queue. */
  async listReportedPostsAdmin(query: {
    search?: string;
    minReportCount?: number;
    sortBy?: string;
    sortOrder?: string;
    skip?: number;
    take?: number;
  }): Promise<PostDocument[]> {
    const safeTake = Math.min(100, Math.max(1, query.take ?? 50));
    return this.postModel
      .find(this.buildReportedPostsFilter(query))
      .sort(this.reportedPostsSort(query))
      .skip(Math.max(0, query.skip ?? 0))
      .limit(safeTake)
      .exec();
  }

  async countReportedPostsAdmin(query: {
    search?: string;
    minReportCount?: number;
  }): Promise<number> {
    return this.postModel
      .countDocuments(this.buildReportedPostsFilter(query))
      .exec();
  }

  private buildReportedPostsFilter(query: {
    search?: string;
    minReportCount?: number;
  }): Record<string, unknown> {
    const min = Math.max(1, query.minReportCount ?? 1);
    const filter: Record<string, unknown> = { reportCount: { $gte: min } };
    const term = query.search?.trim();
    if (term) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$and = [
        { reportCount: { $gte: min } },
        {
          $or: [{ contentText: regex }, { 'options.label': regex }],
        },
      ];
      delete filter.reportCount;
    }
    return filter;
  }

  private reportedPostsSort(query: {
    sortBy?: string;
    sortOrder?: string;
  }): Record<string, 1 | -1> {
    const dir: 1 | -1 = query.sortOrder === 'asc' ? 1 : -1;
    switch (query.sortBy) {
      case 'createdAt':
        return { createdAt: dir };
      case 'updatedAt':
        return { updatedAt: dir };
      case 'reportCount':
      default:
        return { reportCount: dir, createdAt: -1 };
    }
  }

  private buildPlatformPostsFilter(query: {
    search?: string;
    status?: PostStatus;
    categoryId?: string;
    votingFilter?: string;
    scope?: string;
  }): Record<string, unknown> {
    // `user` scope → normal-user posts broadcast platform-wide.
    // `user-all` scope → normal (friend-only / non-broadcast) user posts.
    // `admin` (default) → admin SYSTEM platform posts.
    const filter: Record<string, unknown> =
      query.scope === 'user'
        ? { type: PostType.USER, isUserGlobalBroadcast: true }
        : query.scope === 'user-all'
          ? { type: PostType.USER, isUserGlobalBroadcast: { $ne: true } }
          : { type: PostType.SYSTEM };
    if (query.status) filter.status = query.status;
    if (query.categoryId && Types.ObjectId.isValid(query.categoryId)) {
      filter.categoryId = new Types.ObjectId(query.categoryId);
    }
    const now = new Date();
    if (query.votingFilter === 'live') {
      filter.$or = [
        { votingEndsAt: { $exists: false } },
        { votingEndsAt: null },
        { votingEndsAt: { $gt: now } },
      ];
    } else if (query.votingFilter === 'closed') {
      filter.votingEndsAt = { $lte: now };
    }
    const term = query.search?.trim();
    if (term) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$and = [
        ...((filter.$and as unknown[]) ?? []),
        {
          $or: [{ contentText: regex }, { 'options.label': regex }],
        },
      ];
    }
    return filter;
  }

  private platformPostsSort(query: {
    sortBy?: string;
    sortOrder?: string;
  }): Record<string, 1 | -1> {
    const dir: 1 | -1 = query.sortOrder === 'asc' ? 1 : -1;
    switch (query.sortBy) {
      case 'votes':
        return { voteCount: dir, createdAt: -1 };
      case 'caption':
        return { contentText: dir, createdAt: -1 };
      case 'updatedAt':
        return { updatedAt: dir };
      case 'createdAt':
        return { feedPriority: -1, createdAt: dir };
      default:
        return { feedPriority: -1, createdAt: -1 };
    }
  }

  async findByAuthor(authorId: string, limit = 50): Promise<PostDocument[]> {
    if (!Types.ObjectId.isValid(authorId)) return [];
    return this.postModel
      .find({
        createdBy: new Types.ObjectId(authorId),
        status: { $ne: PostStatus.SCHEDULED },
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  async findScheduledByAuthor(authorId: string): Promise<PostDocument[]> {
    if (!Types.ObjectId.isValid(authorId)) return [];
    return this.postModel
      .find({
        createdBy: new Types.ObjectId(authorId),
        status: PostStatus.SCHEDULED,
      })
      .sort({ scheduledAt: 1 })
      .exec();
  }

  async publishScheduledPosts(): Promise<void> {
    const now = new Date();
    const due = await this.postModel
      .find(
        { status: PostStatus.SCHEDULED, scheduledAt: { $lte: now } },
        { _id: 1, scheduledAt: 1, matchType: 1, votingEndsAt: 1 },
      )
      .lean()
      .exec();

    for (const row of due) {
      const postId = row._id.toString();
      const goLiveAt = row.scheduledAt ?? now;
      // Match posts: sort by kickoff time (votingEndsAt) so they appear fresh
      // in the feed after voting, not buried 24h deep from their scheduledAt.
      const feedTime = row.matchType && row.votingEndsAt ? row.votingEndsAt : goLiveAt;
      try {
        // Atomic flip prevents race issues across multiple app instances.
        const updated = await this.postModel
          .findOneAndUpdate(
            { _id: row._id, status: PostStatus.SCHEDULED },
            {
              $set: {
                status: PostStatus.PUBLISHED,
                createdAt: feedTime,
              },
            },
            { new: true },
          )
          .exec();
        if (!updated) continue;
        this.logger.log(
          `Published scheduled post ${postId} at ${goLiveAt.toISOString()}`,
        );
        await this.publishNewPost(postId);
        await this.notificationsService.create({
          userId: updated.createdBy.toHexString(),
          type: 'ANNOUNCEMENT',
          title: 'Scheduled post is now live',
          body: 'Your scheduled post has been published to the feed.',
          referenceId: postId,
          referenceType: 'Post',
          postId,
        });
      } catch (err) {
        this.logger.warn(
          `Failed to publish scheduled post ${postId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  async cancelScheduledPost(userId: string, postId: string): Promise<boolean> {
    const post = await this.findById(postId);
    if (!post) throw new NotFoundException('Post not found');
    if (post.createdBy.toHexString() !== userId) {
      throw new ForbiddenException('Not your post');
    }
    if (post.status !== PostStatus.SCHEDULED) {
      throw new BadRequestException('Post is not scheduled');
    }
    await this.postModel.deleteOne({ _id: post._id });
    return true;
  }

  async updatePost(
    userId: string,
    postId: string,
    input: UpdatePostInput,
    requesterRole?: string,
  ): Promise<PostDocument> {
    const post = await this.postModel.findById(postId).exec();
    if (!post) throw new NotFoundException('Post not found');
    const isAdmin =
      requesterRole === UserRole.ADMIN || requesterRole === 'admin';
    const isOwner = post.createdBy.toHexString() === userId;
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('Only the author can edit this post');
    }
    if (!isOwner && isAdmin && post.type !== PostType.SYSTEM) {
      throw new ForbiddenException(
        'Admins can only edit platform-wide (system) posts',
      );
    }
    if (input.caption !== undefined) post.contentText = input.caption;

    // Item edits: appending new images keeps existing votes, but changing or
    // removing an EXISTING image invalidates prior votes, so they're wiped.
    // Detection is based on imageUrls (the actual compare images) so that
    // caption / label / category / focal-point edits never reset votes — and so
    // older clients that send label-only options stay backward compatible.
    // The client decides when votes must be reset: re-cropping/repositioning an
    // existing image keeps votes (resetVotes omitted/false); replacing it with a
    // different photo, or adding/removing options, sends resetVotes: true.
    const resetVotes = input.resetVotes === true;
    if (input.imageUrls) {
      // Compare images must stay ≥2 (the post's actual options); poll body/
      // context photos can be any count, including 0 when all are removed.
      const isCompareFmt =
        (post.format ?? PostFormat.COMPARE) === PostFormat.COMPARE;
      if (!isCompareFmt || input.imageUrls.length >= 2) {
        post.imageUrls = input.imageUrls;
      }
    }
    if (input.options && input.options.length >= 2) {
      post.options = input.options.map((o) => this.mapOptionInput(o));
    }

    if (input.categoryId) {
      post.categoryId = new Types.ObjectId(input.categoryId);
    }
    if (input.campaignId !== undefined) {
      const campaignOid = await this.resolveCampaignId(input.campaignId);
      if (campaignOid) {
        post.campaignId = campaignOid;
      } else {
        post.set('campaignId', undefined);
      }
    }
    if (input.endingSoonLeadMinutes !== undefined) {
      post.endingSoonLeadMinutes = Math.max(
        1,
        Math.min(1440, Math.round(input.endingSoonLeadMinutes)),
      );
    }
    if (input.votingEndsAt !== undefined) {
      // Empty string clears the end date; otherwise must be a future date-time.
      post.votingEndsAt = this.parseFutureDate(
        input.votingEndsAt,
        'votingEndsAt',
      );
    }
    if (input.scheduledAt !== undefined) {
      const scheduledAt = this.parseFutureDate(
        input.scheduledAt,
        'scheduledAt',
      );
      if (scheduledAt) {
        post.scheduledAt = scheduledAt;
        post.status = PostStatus.SCHEDULED;
      } else {
        post.set('scheduledAt', undefined);
        if (post.status === PostStatus.SCHEDULED) {
          post.status = PostStatus.PUBLISHED;
        }
      }
    }
    if (input.broadcastGlobally !== undefined && post.type === PostType.USER) {
      const wantsGlobal = Boolean(input.broadcastGlobally);
      if (wantsGlobal && !post.isUserGlobalBroadcast) {
        const allowed =
          await this.platformSettingsService.isUserGlobalPostsAllowed();
        if (!allowed) {
          throw new ForbiddenException(
            'Global posting for users is disabled by the platform',
          );
        }
      }
      post.isUserGlobalBroadcast = wantsGlobal;
      post.feedPriority = wantsGlobal ? 50 : 0;
    }
    if (isAdmin) {
      const editorId = new Types.ObjectId(userId);
      const existing = post.editedByIds ?? [];
      if (!existing.some((id) => id.equals(editorId))) {
        post.editedByIds = [...existing, editorId];
      }
      post.lastEditedById = editorId;
    }
    if (resetVotes) {
      await this.votesService.resetForPost(postId);
      post.voteCount = 0;
    }
    const saved = await post.save();
    await this.safePubsubPublish(POST_UPDATED, {
      postUpdated: { postId: saved._id.toHexString() },
    });
    return saved;
  }

  /**
   * True when an edit changed or removed any *existing* compare image (vs only
   * appending new ones) — which means prior votes must be reset.
   */
  private existingImageUrlsChanged(
    oldUrls: string[],
    newUrls: string[],
  ): boolean {
    if (newUrls.length < oldUrls.length) return true;
    for (let i = 0; i < oldUrls.length; i++) {
      if ((oldUrls[i] ?? '') !== (newUrls[i] ?? '')) return true;
    }
    return false;
  }

  /**
   * True when an edit swapped the image of an *existing* option (vs only its
   * label). Used for poll thumbnails, whose URLs live on `options[i].imageUrl`
   * rather than `imageUrls`. Only options whose new payload actually carries an
   * `imageUrl` are compared — a label-only option (imageUrl undefined) is left
   * alone, which keeps older/label-only clients backward compatible.
   */
  private existingOptionImagesChanged(
    oldOptions: { imageUrl?: string }[],
    newOptions: { imageUrl?: string | null }[],
  ): boolean {
    const n = Math.min(oldOptions.length, newOptions.length);
    for (let i = 0; i < n; i++) {
      const newImg = newOptions[i]?.imageUrl;
      if (newImg === undefined || newImg === null) continue;
      if (newImg !== (oldOptions[i]?.imageUrl ?? '')) return true;
    }
    return false;
  }

  async deletePost(
    requesterId: string,
    requesterRole: string,
    postId: string,
  ): Promise<boolean> {
    const post = await this.findById(postId);
    if (!post) throw new NotFoundException('Post not found');

    const isAdmin =
      requesterRole === UserRole.ADMIN || requesterRole === 'admin';
    const isOwner = post.createdBy.toHexString() === requesterId;

    if (!isAdmin && !isOwner) {
      throw new ForbiddenException('You can only delete your own posts');
    }

    const pid = post._id;
    await Promise.all([
      this.postModel.deleteOne({ _id: pid }),
      this.savedPostModel.deleteMany({ postId: pid }),
      this.postReactionModel.deleteMany({ postId: pid }),
      this.commentModel.deleteMany({ postId: pid }),
      this.contentReportsService.deleteReportsForPost(pid.toHexString()),
    ]);
    // Notify all connected feed clients so the post disappears in real time.
    await this.safePubsubPublish(POST_DELETED, {
      postDeleted: { postId: pid.toHexString() },
    });
    return true;
  }

  async listVotedPosts(
    userId: string,
    anonymousOnly = false,
    limit = 100,
  ): Promise<PostDocument[]> {
    const postIds = await this.votesService.listVotedPostIds(
      userId,
      anonymousOnly,
    );
    if (!postIds.length) return [];
    const limited = postIds.slice(0, limit);
    const posts = await this.postModel.find({ _id: { $in: limited } }).exec();
    const byId = new Map(posts.map((p) => [p._id.toHexString(), p]));
    const ordered: PostDocument[] = [];
    for (const id of limited) {
      const row = byId.get(id.toHexString());
      if (row) ordered.push(row as PostDocument);
    }
    return ordered;
  }

  async listSavedPosts(userId: string, limit = 100): Promise<PostDocument[]> {
    if (!Types.ObjectId.isValid(userId)) return [];
    const saves = await this.savedPostModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
    const postIds = saves.map((s) => s.postId);
    if (!postIds.length) return [];
    const posts = await this.postModel.find({ _id: { $in: postIds } }).exec();
    const byId = new Map(posts.map((p) => [p._id.toHexString(), p]));
    const ordered: PostDocument[] = [];
    for (const id of postIds) {
      const row = byId.get(id.toHexString());
      if (row) ordered.push(row as PostDocument);
    }
    return ordered;
  }

  async setSaved(
    userId: string,
    postId: string,
    keep: boolean,
  ): Promise<boolean> {
    const post = await this.findById(postId);
    if (!post) throw new NotFoundException('Post not found');
    const uid = new Types.ObjectId(userId);
    const pid = post._id;
    if (keep) {
      await this.savedPostModel.updateOne(
        { userId: uid, postId: pid },
        { $setOnInsert: { userId: uid, postId: pid } },
        { upsert: true },
      );
      return true;
    }
    await this.savedPostModel.deleteOne({ userId: uid, postId: pid });
    return false;
  }

  async setReaction(
    userId: string,
    postId: string,
    kind: PostReactionKind,
    active: boolean,
  ): Promise<void> {
    const post = await this.findById(postId);
    if (!post) throw new NotFoundException('Post not found');
    if (post.likesDisabled) {
      throw new ForbiddenException('Reactions are disabled on this post');
    }
    const uid = new Types.ObjectId(userId);
    const pid = post._id;
    if (active) {
      const result = await this.postReactionModel.updateOne(
        { userId: uid, postId: pid, kind },
        { $setOnInsert: { userId: uid, postId: pid, kind } },
        { upsert: true },
      );
      // Only notify on a fresh hype (not on re-asserting the same reaction)
      if (kind === 'hype' && result.upsertedCount > 0) {
        const actor = await this.usersService.findById(userId);
        const name = actor?.displayName?.trim() || actor?.username || 'Someone';
        await this.notificationsService.createOrUpdateGrouped({
          userId: post.createdBy.toHexString(),
          type: 'POST_HYPE',
          referenceId: post._id.toHexString(),
          referenceType: 'Post',
          actorId: userId,
          actorName: name,
          verbPhrase: 'hyped your post',
          title: 'New hype on your post',
        });
      }
      return;
    }
    await this.postReactionModel.deleteOne({ userId: uid, postId: pid, kind });
  }

  async create(
    authorId: string,
    input: CreatePostInput,
  ): Promise<PostDocument> {
    const type = input.type ?? PostType.USER;
    const format = input.format ?? PostFormat.COMPARE;
    this.validateFormatInput(format, input);
    const category = await this.categoriesService.findById(input.categoryId);
    if (!category) throw new BadRequestException('Invalid category');

    const author = await this.usersService.findById(authorId);
    if (!author) throw new NotFoundException('User not found');

    if (type === PostType.SYSTEM) {
      throw new BadRequestException('Use createSystemPost (admin)');
    }

    if (type === PostType.ORG) {
      if (author.role !== UserRole.ORG) {
        throw new ForbiddenException('Organization account required');
      }
      return this.createOrgPost(authorId, input, category);
    }

    if (type === PostType.USER && author.role === UserRole.ADMIN) {
      // admin can still post as user-style compare post
    }

    const wantsGlobal = Boolean(input.broadcastGlobally);
    if (wantsGlobal) {
      if (author.role === UserRole.ADMIN) {
        throw new BadRequestException(
          'Admins: use createSystemPost for platform-wide posts',
        );
      }
      const allowed =
        await this.platformSettingsService.isUserGlobalPostsAllowed();
      if (!allowed) {
        throw new ForbiddenException(
          'Global posting for users is disabled by the platform',
        );
      }
    }

    const visibility = input.visibility ?? Visibility.PUBLIC;
    const contentText = input.contentText ?? input.caption;
    const votingEndsAt = this.parseFutureDate(
      input.votingEndsAt,
      'votingEndsAt',
    );
    const scheduledAt = this.parseFutureDate(input.scheduledAt, 'scheduledAt');
    const status = scheduledAt ? PostStatus.SCHEDULED : PostStatus.PUBLISHED;
    const campaignOid = await this.resolveCampaignId(
      input.campaignId,
      authorId,
      author.role,
    );
    const doc = await this.postModel.create({
      type: PostType.USER,
      format,
      contentText,
      imageUrls: input.imageUrls ?? [],
      options: input.options.map((o) => this.mapOptionInput(o)),
      categoryId: category._id,
      visibility,
      createdBy: new Types.ObjectId(authorId),
      isUserGlobalBroadcast: wantsGlobal,
      feedPriority: wantsGlobal ? 50 : 0,
      voteCount: 0,
      commentsDisabled: false,
      likesDisabled: false,
      votingEndsAt,
      endingSoonLeadMinutes: DEFAULT_ENDING_SOON_LEAD_MINUTES,
      status,
      scheduledAt,
      campaignId: campaignOid,
    });
    if (status === PostStatus.PUBLISHED) {
      await this.publishNewPost(doc._id.toHexString());
    }
    return doc;
  }

  private async createOrgPost(
    authorId: string,
    input: CreatePostInput,
    category: CategoryDocument,
  ) {
    const org = await this.organizationsService.getOrgForUser(authorId);
    if (!org) throw new BadRequestException('No organization for user');

    let orgReach = input.orgReach ?? OrgPostReach.CONNECTED;
    const visibility = input.visibility ?? Visibility.PUBLIC;

    if (org.subscriptionPlan !== SubscriptionPlan.PREMIUM) {
      orgReach = OrgPostReach.CONNECTED;
    }

    if (orgReach === OrgPostReach.GLOBAL) {
      const key = currentMonthKey();
      if (org.globalPostsMonthKey !== key) {
        org.globalPostsMonthKey = key;
        org.globalPostsThisMonth = 0;
      }
      if (org.globalPostsThisMonth >= PREMIUM_GLOBAL_MONTHLY) {
        throw new BadRequestException(
          `Premium global post limit (${PREMIUM_GLOBAL_MONTHLY}/month) reached`,
        );
      }
      org.globalPostsThisMonth += 1;
      await org.save();
    }

    const contentText = input.contentText ?? input.caption;
    const votingEndsAt = this.parseFutureDate(
      input.votingEndsAt,
      'votingEndsAt',
    );
    const scheduledAt = this.parseFutureDate(input.scheduledAt, 'scheduledAt');
    const status = scheduledAt ? PostStatus.SCHEDULED : PostStatus.PUBLISHED;
    const campaignOid = await this.resolveCampaignId(input.campaignId);
    const doc = await this.postModel.create({
      type: PostType.ORG,
      format: input.format ?? PostFormat.COMPARE,
      contentText,
      imageUrls: input.imageUrls ?? [],
      options: input.options.map((o) => this.mapOptionInput(o)),
      categoryId: category._id,
      visibility,
      createdBy: new Types.ObjectId(authorId),
      organizationId: org._id,
      orgReach,
      feedPriority: 0,
      voteCount: 0,
      commentsDisabled: false,
      likesDisabled: false,
      votingEndsAt,
      endingSoonLeadMinutes: DEFAULT_ENDING_SOON_LEAD_MINUTES,
      status,
      scheduledAt,
      campaignId: campaignOid,
    });
    if (status === PostStatus.PUBLISHED) {
      await this.publishNewPost(doc._id.toHexString());
    }
    return doc;
  }

  async createSystemPost(
    adminId: string,
    input: CreatePostInput,
  ): Promise<PostDocument> {
    const admin = await this.usersService.findById(adminId);
    if (!admin || admin.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin only');
    }
    const category = await this.categoriesService.findById(input.categoryId);
    if (!category) throw new BadRequestException('Invalid category');

    const format = input.format ?? PostFormat.COMPARE;
    this.validateFormatInput(format, input);
    const contentText = input.contentText ?? input.caption;
    const votingEndsAt = this.parseFutureDate(
      input.votingEndsAt,
      'votingEndsAt',
    );
    const scheduledAt = this.parseFutureDate(input.scheduledAt, 'scheduledAt');
    const status = scheduledAt ? PostStatus.SCHEDULED : PostStatus.PUBLISHED;
    const campaignOid = await this.resolveCampaignId(input.campaignId);
    const isAnnouncement = format === PostFormat.ANNOUNCEMENT;
    const doc = await this.postModel.create({
      type: PostType.SYSTEM,
      format,
      contentText,
      imageUrls: input.imageUrls ?? [],
      options: isAnnouncement ? [] : (input.options ?? []).map((o) => this.mapOptionInput(o)),
      categoryId: category._id,
      visibility: Visibility.PUBLIC,
      createdBy: new Types.ObjectId(adminId),
      feedPriority: 100,
      voteCount: 0,
      commentsDisabled: false,
      likesDisabled: false,
      ...(isAnnouncement ? {} : { votingEndsAt, endingSoonLeadMinutes: DEFAULT_ENDING_SOON_LEAD_MINUTES }),
      status,
      scheduledAt,
      campaignId: campaignOid,
    });
    if (status === PostStatus.PUBLISHED) {
      await this.publishNewPost(doc._id.toHexString());
    }
    return doc;
  }

  /** Publish feed subscription + user notifications after a post goes live. */
  async onPostPublished(postId: string): Promise<void> {
    await this.publishNewPost(postId);
  }

  private async publishNewPost(postId: string) {
    try {
      const post = await this.postModel.findById(postId).exec();
      if (!post || post.status !== PostStatus.PUBLISHED) {
        return;
      }
      await this.safePubsubPublish(NEW_POST, { newPost: { postId } });
      const authorId = post.createdBy.toHexString();
      const author = await this.usersService.findById(authorId);
      const authorName =
        author?.displayName?.trim() || author?.username || 'CTrend';
      const caption = (post.contentText ?? '').trim();

      if (post.type === PostType.SYSTEM) {
        // Platform-wide posts → every user (except author) gets a bell notification.
        await this.notificationsService.notifyAllUsersOfPlatformPost({
          postId,
          authorId,
          authorName: PLATFORM_BRAND_NAME,
          caption,
          isAnnouncement: post.format === PostFormat.ANNOUNCEMENT,
        });
        return;
      }

      if (post.type === PostType.USER && post.isUserGlobalBroadcast) {
        await this.notificationsService.notifyAllUsersOfUserGlobalPost({
          postId,
          authorId,
          authorName,
          caption,
        });
        return;
      }

      // USER posts → notify the author's friends only.
      const friends = await this.followsService.getMyFriends(authorId);
      const body = caption
        ? `${authorName} posted: ${caption.slice(0, 80)}`
        : `${authorName} shared a new compare`;
      await Promise.all(
        friends.map((f) =>
          this.notificationsService.create({
            userId: f.id,
            type: 'NEW_POST_FRIEND',
            title: `${authorName} shared a new post`,
            body,
            referenceId: postId,
            referenceType: 'Post',
            postId,
            actorId: authorId,
            actorName: authorName,
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(
        `Post notification fan-out failed for ${postId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private parseFutureDate(
    value: Date | string | undefined,
    fieldName: string,
  ): Date | undefined {
    if (!value) return undefined;
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(
        `${fieldName} must be a valid ISO date-time`,
      );
    }
    if (parsed.getTime() <= Date.now()) {
      throw new BadRequestException(`${fieldName} must be a future date-time`);
    }
    return parsed;
  }

  async extendVotingWindow(
    actorUserId: string,
    postId: string,
    newVotingEndsAt: string,
  ): Promise<PostDocument> {
    const post = await this.findById(postId);
    if (!post) throw new NotFoundException('Post not found');
    if (post.createdBy.toHexString() !== actorUserId) {
      throw new ForbiddenException(
        'Only the post author can extend voting time',
      );
    }
    const nextEndAt = this.parseFutureDate(newVotingEndsAt, 'newVotingEndsAt');
    if (!nextEndAt) {
      throw new BadRequestException('newVotingEndsAt is required');
    }
    if (post.votingEndsAt && nextEndAt <= post.votingEndsAt) {
      throw new BadRequestException(
        'newVotingEndsAt must be later than current votingEndsAt',
      );
    }
    post.votingEndsAt = nextEndAt;
    await post.save();
    await this.safePubsubPublish(POST_VOTE_UPDATED, {
      postVoteUpdated: { postId: post._id.toHexString() },
    });
    return post;
  }

  async toGql(post: PostDocument, viewerId?: string): Promise<PostGql> {
    const [category, author, commentCount, likeCount, hypeCount, saveCount] =
      await Promise.all([
        this.categoriesService.findById(post.categoryId.toString()),
        this.usersService.findById(post.createdBy.toString()),
        this.commentModel.countDocuments({ postId: post._id }).exec(),
        this.postReactionModel
          .countDocuments({ postId: post._id, kind: 'like' })
          .exec(),
        this.postReactionModel
          .countDocuments({ postId: post._id, kind: 'hype' })
          .exec(),
        this.savedPostModel.countDocuments({ postId: post._id }).exec(),
      ]);
    if (!category || !author) {
      throw new NotFoundException('Related data missing');
    }
    const stats = await this.votesService.getStats(
      post._id.toHexString(),
      post.options.length,
    );
    const optionStats = post.options.map((opt, index) => ({
      index,
      label: opt.label,
      count: stats.countsPerOption[index] ?? 0,
      percentage: stats.percentages[index] ?? 0,
    }));
    let mySelected: number | undefined;
    let myVoteAnonymous: boolean | null = null;
    if (viewerId) {
      const [voteIndex, myVote] = await Promise.all([
        this.votesService.getMyVoteIndex(viewerId, post._id.toHexString()),
        this.votesService.getMyVote(viewerId, post._id.toHexString()),
      ]);
      mySelected = voteIndex;
      myVoteAnonymous = myVote ? myVote.anonymous : null;
    }
    const [viewerHasSaved, viewerHasHyped] = await Promise.all([
      viewerId
        ? this.savedPostModel
            .exists({ userId: new Types.ObjectId(viewerId), postId: post._id })
            .exec()
        : Promise.resolve(null),
      viewerId
        ? this.postReactionModel
            .exists({
              userId: new Types.ObjectId(viewerId),
              postId: post._id,
              kind: 'hype',
            })
            .exec()
        : Promise.resolve(null),
    ]);
    const now = Date.now();
    const isVotingOpen =
      post.format !== PostFormat.ANNOUNCEMENT &&
      (!post.votingEndsAt || post.votingEndsAt.getTime() > now);
    const isPrizeClaimed = Boolean(post.votePrizeClaimedAt);
    const viewerIsWinner =
      Boolean(viewerId) &&
      Boolean(post.voteWinnerUserId) &&
      post.voteWinnerUserId!.toHexString() === viewerId;
    const canClaimPrize =
      this.isPrizeClaimEligiblePost(post) &&
      !isVotingOpen &&
      viewerIsWinner &&
      !isPrizeClaimed;

    let postForGql = post;
    if (!isVotingOpen) {
      postForGql = await this.ensureVoteWinnerDrawn(
        post,
        stats.countsPerOption,
      );
    }

    let campaign: PostCampaignSummaryGql | null = null;
    if (postForGql.campaignId) {
      const campaignDoc = await this.campaignsService.findById(
        postForGql.campaignId.toHexString(),
      );
      if (campaignDoc) {
        campaign = this.toCampaignSummary(campaignDoc);
      }
    }

    const campaignWinner = postForGql.campaignId
      ? await this.worldCupCampaignService.findByPostId(
          postForGql._id.toHexString(),
        )
      : null;

    let voteWinner: PostVoteWinnerGql | null = null;
    if (postForGql.voteWinnerUserId && postForGql.voteWinnerPickedAt) {
      const winnerUser = await this.usersService.findById(
        postForGql.voteWinnerUserId.toHexString(),
      );
      if (winnerUser) {
        voteWinner = {
          user: this.usersService.toGql(winnerUser),
          selectedOptionIndex: postForGql.voteWinnerOptionIndex,
          pickedAt: postForGql.voteWinnerPickedAt,
        };
      }
    }

    let editedBy: UserGql[] | undefined;
    let lastEditedBy: UserGql | undefined;
    const editorIdSet = new Set<string>();
    for (const id of post.editedByIds ?? []) {
      editorIdSet.add(id.toHexString());
    }
    if (post.lastEditedById) {
      editorIdSet.add(post.lastEditedById.toHexString());
    }
    if (editorIdSet.size > 0) {
      const editors = await this.usersService.findByIds([...editorIdSet]);
      const byId = new Map(
        editors.map((u) => [u._id.toHexString(), u] as const),
      );
      editedBy = (post.editedByIds ?? [])
        .map((id) => byId.get(id.toHexString()))
        .filter((u): u is NonNullable<typeof u> => Boolean(u))
        .map((u) => this.usersService.toGql(u));
      const lastDoc = post.lastEditedById
        ? byId.get(post.lastEditedById.toHexString())
        : undefined;
      if (lastDoc) lastEditedBy = this.usersService.toGql(lastDoc);
    }

    return {
      id: post._id.toHexString(),
      type: post.type,
      format: post.format ?? PostFormat.COMPARE,
      contentText: post.contentText,
      caption: post.contentText,
      imageUrls: post.imageUrls ?? [],
      imageUrl: (post.imageUrls ?? [])[0],
      options: post.options.map((o) => ({
        label: o.label,
        imageUrl: o.imageUrl,
        imageFocalX: o.imageFocalX,
        imageFocalY: o.imageFocalY,
      })),
      category: this.categoriesService.toGql(category),
      visibility: post.visibility,
      author: this.usersService.toGql(author as UserDocument),
      authorId: (author as UserDocument)._id.toHexString(),
      authorUsername:
        post.type === PostType.SYSTEM
          ? PLATFORM_BRAND_USERNAME
          : author.username,
      authorDisplayName:
        post.type === PostType.SYSTEM
          ? PLATFORM_BRAND_NAME
          : (author.displayName ?? null),
      authorEmail: post.type === PostType.SYSTEM ? null : author.email,
      authorProfileImageUrl:
        post.type === PostType.SYSTEM ? null : (author.profileImageUrl ?? null),
      orgReach: post.orgReach,
      commentsDisabled: post.commentsDisabled,
      likesDisabled: post.likesDisabled,
      commentCount,
      likeCount,
      hypeCount,
      saveCount,
      viewerHasSaved: !!viewerHasSaved,
      viewerHasHyped: !!viewerHasHyped,
      recentComments: [],
      totalVotes: stats.totalVotes,
      upvoteCount: stats.countsPerOption[0] ?? 0,
      downvoteCount: stats.countsPerOption[1] ?? 0,
      optionStats,
      mySelectedOptionIndex: mySelected,
      myVoteAnonymous,
      viewerVote:
        mySelected === undefined ? null : mySelected === 0 ? 'up' : 'down',
      votingEndsAt: post.votingEndsAt,
      endingSoonLeadMinutes:
        post.endingSoonLeadMinutes ?? DEFAULT_ENDING_SOON_LEAD_MINUTES,
      isVotingOpen,
      createdAt: post.createdAt ?? new Date(),
      updatedAt: (post as PostDocument).updatedAt ?? post.createdAt,
      status: post.status ?? PostStatus.PUBLISHED,
      scheduledAt: post.scheduledAt,
      editedBy,
      lastEditedBy,
      campaign,
      voteWinner,
      isPrizeClaimed,
      votePrizeClaimedAt: post.votePrizeClaimedAt,
      canClaimPrize,
      isUserGlobalBroadcast: Boolean(post.isUserGlobalBroadcast),
      reportCount: post.reportCount ?? 0,
      campaignWinner,
      matchType: post.matchType ?? false,
      matchScore:
        post.matchType && post.fixtureScore != null
          ? {
              home: post.fixtureScore.home ?? null,
              away: post.fixtureScore.away ?? null,
              status: post.fixtureStatus ?? null,
              minute: post.fixtureMinute ?? null,
            }
          : null,
      fixtureWinnerAt: post.fixtureWinnerAt ?? null,
    };
  }
}
