import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Organization,
  OrganizationDocument,
} from './organization.schema';
import { UserRole, SubscriptionPlan } from '../common/enums';
import { UsersService } from '../users/users.service';
import { OrganizationGql } from './graphql/org.types';
import { Post, PostDocument } from '../posts/post.schema';
import { Vote, VoteDocument } from '../votes/vote.schema';
import { Comment, CommentDocument } from '../comments/comment.schema';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectModel(Organization.name)
    private orgModel: Model<OrganizationDocument>,
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    @InjectModel(Vote.name) private voteModel: Model<VoteDocument>,
    @InjectModel(Comment.name) private commentModel: Model<CommentDocument>,
    private usersService: UsersService,
  ) {}

  orgToGql(doc: OrganizationDocument): OrganizationGql {
    return {
      id: doc._id.toHexString(),
      name: doc.name,
      ownerUserId: doc.ownerUserId.toHexString(),
      subscriptionPlan: doc.subscriptionPlan,
      postLimit: doc.postLimit,
      postsUsed: doc.postsUsed,
      globalPostsThisMonth: doc.globalPostsThisMonth ?? 0,
    };
  }

  async findByOwnerUserId(
    ownerUserId: string,
  ): Promise<OrganizationDocument | null> {
    return this.orgModel
      .findOne({ ownerUserId: new Types.ObjectId(ownerUserId) })
      .exec();
  }

  async createOrganization(ownerUserId: string, name: string) {
    const user = await this.usersService.findById(ownerUserId);
    if (!user) throw new NotFoundException('User not found');
    if (user.role === UserRole.ORG) {
      const existing = await this.findByOwnerUserId(ownerUserId);
      if (existing) throw new BadRequestException('Organization already exists');
    }
    const org = await this.orgModel.create({
      name,
      ownerUserId: new Types.ObjectId(ownerUserId),
      subscriptionPlan: SubscriptionPlan.FREE,
      postLimit: 0,
      postsUsed: 0,
      globalPostsThisMonth: 0,
    });
    user.role = UserRole.ORG;
    await user.save();
    return org;
  }

  async getOrgForUser(userId: string): Promise<OrganizationDocument | null> {
    return this.findByOwnerUserId(userId);
  }

  async assertOrgOwnedBy(
    organizationId: string,
    ownerUserId: string,
  ): Promise<OrganizationDocument> {
    const org = await this.orgModel.findById(organizationId);
    if (!org || org.ownerUserId.toHexString() !== ownerUserId) {
      throw new NotFoundException('Organization not found');
    }
    return org;
  }

  async setPremiumFromWebhook(
    organizationId: string,
    _stripeCustomerId?: string,
    _stripeSubscriptionId?: string,
  ) {
    const org = await this.orgModel.findById(organizationId);
    if (!org) return;
    org.subscriptionPlan = SubscriptionPlan.PREMIUM;
    org.postLimit = 20;
    await org.save();
  }

  async dashboard(orgId: string, ownerUserId: string) {
    const org = await this.orgModel.findById(orgId);
    if (!org || org.ownerUserId.toHexString() !== ownerUserId) {
      throw new NotFoundException('Organization not found');
    }
    const posts = await this.postModel.countDocuments({
      organizationId: org._id,
    });
    const postIds = await this.postModel
      .find({ organizationId: org._id })
      .select('_id')
      .lean();
    const ids = postIds.map((p) => p._id);
    const [votes, comments] = await Promise.all([
      ids.length
        ? this.voteModel.countDocuments({ postId: { $in: ids } })
        : 0,
      ids.length
        ? this.commentModel.countDocuments({ postId: { $in: ids } })
        : 0,
    ]);
    return {
      totalPosts: posts,
      totalVotes: votes,
      totalComments: comments,
      estimatedReach: votes * 3 + comments * 2,
    };
  }
}
