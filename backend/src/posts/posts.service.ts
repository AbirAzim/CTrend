import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Post, PostDocument } from './post.schema';
import { CreatePostInput } from './dto/create-post.input';
import {
  OrgPostReach,
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
import { pubsub, NEW_POST } from '../pubsub';

const PREMIUM_GLOBAL_MONTHLY = 20;

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class PostsService {
  constructor(
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    private categoriesService: CategoriesService,
    private organizationsService: OrganizationsService,
    private usersService: UsersService,
    private votesService: VotesService,
  ) {}

  async findById(id: string): Promise<PostDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.postModel.findById(id).exec();
  }

  async findByAuthor(authorId: string, limit = 50): Promise<PostDocument[]> {
    if (!Types.ObjectId.isValid(authorId)) return [];
    return this.postModel
      .find({ createdBy: new Types.ObjectId(authorId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  async create(authorId: string, input: CreatePostInput): Promise<PostDocument> {
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
    const doc = await this.postModel.create({
      type: PostType.USER,
      contentText: input.contentText,
      imageUrls: input.imageUrls ?? [],
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
    });
    await this.publishNewPost(doc._id.toHexString());
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

    const doc = await this.postModel.create({
      type: PostType.ORG,
      contentText: input.contentText,
      imageUrls: input.imageUrls ?? [],
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
    });
    await this.publishNewPost(doc._id.toHexString());
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

    const doc = await this.postModel.create({
      type: PostType.SYSTEM,
      contentText: input.contentText,
      imageUrls: input.imageUrls ?? [],
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
      likesDisabled: true,
    });
    await this.publishNewPost(doc._id.toHexString());
    return doc;
  }

  private async publishNewPost(postId: string) {
    await pubsub.publish(NEW_POST, { newPost: { postId } });
  }

  async toGql(
    post: PostDocument,
    viewerId?: string,
  ): Promise<PostGql> {
    const [category, author] = await Promise.all([
      this.categoriesService.findById(post.categoryId.toString()),
      this.usersService.findById(post.createdBy.toString()),
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
    if (viewerId) {
      mySelected = await this.votesService.getMyVoteIndex(
        viewerId,
        post._id.toHexString(),
      );
    }
    return {
      id: post._id.toHexString(),
      type: post.type,
      contentText: post.contentText,
      imageUrls: post.imageUrls ?? [],
      options: post.options.map((o) => ({
        label: o.label,
        imageUrl: o.imageUrl,
      })),
      category: this.categoriesService.toGql(category),
      visibility: post.visibility,
      author: this.usersService.toGql(author as UserDocument),
      orgReach: post.orgReach,
      commentsDisabled: post.commentsDisabled,
      likesDisabled: post.likesDisabled,
      totalVotes: stats.totalVotes,
      optionStats,
      mySelectedOptionIndex: mySelected,
      createdAt: post.createdAt ?? new Date(),
    };
  }
}
