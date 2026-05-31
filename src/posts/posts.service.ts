import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Post, PostDocument } from './post.schema';
import {
  PostReaction,
  PostReactionDocument,
  PostReactionKind,
} from './post-reaction.schema';
import { SavedPost, SavedPostDocument } from './saved-post.schema';
import { CreatePostInput } from './dto/create-post.input';
import { UpdatePostInput } from './dto/update-post.input';
import {
  OrgPostReach,
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
import { NEW_POST, POST_DELETED, POST_VOTE_UPDATED, pubsub } from '../pubsub';
import { Comment, CommentDocument } from '../comments/comment.schema';
import { CommentsService } from '../comments/comments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FollowsService } from '../follows/follows.service';
import { OnModuleInit } from '@nestjs/common';

const PREMIUM_GLOBAL_MONTHLY = 20;

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class PostsService implements OnModuleInit {
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
  ) {}

  async findById(id: string): Promise<PostDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.postModel.findById(id).exec();
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
    const due = await this.postModel
      .find({ status: PostStatus.SCHEDULED, scheduledAt: { $lte: new Date() } })
      .exec();
    for (const post of due) {
      const goLiveAt = post.scheduledAt ?? new Date();
      post.status = PostStatus.PUBLISHED;
      // Feed "posted" time should reflect go-live, not draft creation time.
      post.createdAt = goLiveAt;
      await post.save();
      await this.publishNewPost(post._id.toHexString());
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
  ): Promise<PostDocument> {
    const post = await this.postModel.findById(postId).exec();
    if (!post) throw new NotFoundException('Post not found');
    if (post.createdBy.toHexString() !== userId) {
      throw new ForbiddenException('Only the author can edit this post');
    }
    if (input.caption !== undefined) post.contentText = input.caption;
    if (input.imageUrls && input.imageUrls.length >= 2) {
      post.imageUrls = input.imageUrls;
    }
    if (input.options && input.options.length >= 2) {
      post.options = input.options as any;
    }
    if (input.categoryId) {
      post.categoryId = new Types.ObjectId(input.categoryId);
    }
    return post.save();
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
    ]);
    // Notify all connected feed clients so the post disappears in real time.
    await pubsub.publish(POST_DELETED, {
      postDeleted: { postId: pid.toHexString() },
    });
    return true;
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

    const visibility = input.visibility ?? Visibility.PUBLIC;
    const contentText = input.contentText ?? input.caption;
    const votingEndsAt = this.parseFutureDate(
      input.votingEndsAt,
      'votingEndsAt',
    );
    const scheduledAt = this.parseFutureDate(input.scheduledAt, 'scheduledAt');
    const status = scheduledAt ? PostStatus.SCHEDULED : PostStatus.PUBLISHED;
    const doc = await this.postModel.create({
      type: PostType.USER,
      contentText,
      imageUrls: input.imageUrls,
      options: input.options.map((o) => ({
        label: o.label,
        imageUrl: o.imageUrl,
      })),
      categoryId: category._id,
      visibility,
      createdBy: new Types.ObjectId(authorId),
      feedPriority: 0,
      voteCount: 0,
      commentsDisabled: false,
      likesDisabled: false,
      votingEndsAt,
      status,
      scheduledAt,
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
    const doc = await this.postModel.create({
      type: PostType.ORG,
      contentText,
      imageUrls: input.imageUrls,
      options: input.options.map((o) => ({
        label: o.label,
        imageUrl: o.imageUrl,
      })),
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
      status,
      scheduledAt,
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

    const contentText = input.contentText ?? input.caption;
    const votingEndsAt = this.parseFutureDate(
      input.votingEndsAt,
      'votingEndsAt',
    );
    const scheduledAt = this.parseFutureDate(input.scheduledAt, 'scheduledAt');
    const status = scheduledAt ? PostStatus.SCHEDULED : PostStatus.PUBLISHED;
    const doc = await this.postModel.create({
      type: PostType.SYSTEM,
      contentText,
      imageUrls: input.imageUrls,
      options: input.options.map((o) => ({
        label: o.label,
        imageUrl: o.imageUrl,
      })),
      categoryId: category._id,
      visibility: Visibility.PUBLIC,
      createdBy: new Types.ObjectId(adminId),
      feedPriority: 100,
      voteCount: 0,
      commentsDisabled: false,
      likesDisabled: false,
      votingEndsAt,
      status,
      scheduledAt,
    });
    if (status === PostStatus.PUBLISHED) {
      await this.publishNewPost(doc._id.toHexString());
    }
    return doc;
  }

  private async publishNewPost(postId: string) {
    await pubsub.publish(NEW_POST, { newPost: { postId } });
    try {
      const post = await this.postModel.findById(postId).exec();
      if (!post) return;
      const authorId = post.createdBy.toHexString();
      const author = await this.usersService.findById(authorId);
      const authorName =
        author?.displayName?.trim() || author?.username || 'Someone';
      const caption = (post.contentText ?? '').trim();

      if (post.type === PostType.SYSTEM) {
        // SYSTEM (admin/campaign) posts fan out to ALL users on the platform.
        // The admin who created the post does not receive a notification.
        const allUserIds = await this.usersService.findAllIds();
        const recipients = allUserIds.filter((id) => id !== authorId);
        const body = caption
          ? caption.slice(0, 120)
          : 'A new campaign is live — tap to view.';
        await Promise.all(
          recipients.map((userId) =>
            this.notificationsService.create({
              userId,
              type: 'ANNOUNCEMENT',
              title: `📢 ${authorName} posted a campaign`,
              body,
              referenceId: postId,
              referenceType: 'Post',
              actorId: authorId,
              actorName: authorName,
            }),
          ),
        );
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
            actorId: authorId,
            actorName: authorName,
          }),
        ),
      );
    } catch {
      // Don't fail post-create flow if notifications fan-out fails
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
    await pubsub.publish(POST_VOTE_UPDATED, {
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
      !post.votingEndsAt || post.votingEndsAt.getTime() > now;
    return {
      id: post._id.toHexString(),
      type: post.type,
      contentText: post.contentText,
      caption: post.contentText,
      imageUrls: post.imageUrls ?? [],
      imageUrl: (post.imageUrls ?? [])[0],
      options: post.options.map((o) => ({
        label: o.label,
        imageUrl: o.imageUrl,
      })),
      category: this.categoriesService.toGql(category),
      visibility: post.visibility,
      author: this.usersService.toGql(author as UserDocument),
      authorId: (author as UserDocument)._id.toHexString(),
      authorUsername: author.username,
      authorDisplayName: author.displayName ?? null,
      authorEmail: author.email,
      authorProfileImageUrl: author.profileImageUrl ?? null,
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
      isVotingOpen,
      createdAt: post.createdAt ?? new Date(),
      status: post.status ?? PostStatus.PUBLISHED,
      scheduledAt: post.scheduledAt,
    };
  }
}
