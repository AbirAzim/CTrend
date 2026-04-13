import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Post, PostDocument } from '../posts/post.schema';
import {
  FeedScope,
  FeedSort,
  OrgPostReach,
  PostType,
  Visibility,
} from '../common/enums';
import { PostsService } from '../posts/posts.service';
import { CategoriesService } from '../categories/categories.service';
import { FollowsService } from '../follows/follows.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class FeedService {
  constructor(
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    private postsService: PostsService,
    private categoriesService: CategoriesService,
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
  ) {
    const filter = await this.buildFilter(scope, viewerId);
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
  ): Promise<Record<string, unknown>> {
    const globalPublic: Record<string, unknown>[] = [
      { type: PostType.SYSTEM },
      { type: PostType.USER, visibility: Visibility.PUBLIC },
      {
        type: PostType.ORG,
        orgReach: OrgPostReach.GLOBAL,
      },
    ];

    if (scope === FeedScope.GLOBAL) {
      return { $or: globalPublic };
    }

    if (!viewerId) {
      return { $or: globalPublic };
    }

    const viewerOid = new Types.ObjectId(viewerId);
    const followingIds = await this.followsService.getFollowingIds(viewerId);
    const followingOids = followingIds.map((id) => new Types.ObjectId(id));

    const interestCategoryIds = await this.resolveInterestCategoryIds(viewerId);

    const privateFromFollowed =
      followingOids.length > 0
        ? {
            type: PostType.USER,
            visibility: Visibility.PRIVATE,
            createdBy: { $in: followingOids },
          }
        : null;

    const orgConnectedIds = await this.orgIdsForFollowedOwners(followingIds);
    const orgConnected =
      orgConnectedIds.length > 0
        ? {
            type: PostType.ORG,
            orgReach: OrgPostReach.CONNECTED,
            organizationId: { $in: orgConnectedIds },
          }
        : null;

    const parts: Record<string, unknown>[] = [
      { type: PostType.SYSTEM },
      { createdBy: viewerOid },
    ];
    if (interestCategoryIds.length) {
      parts.push({ categoryId: { $in: interestCategoryIds } });
    }
    if (privateFromFollowed) parts.push(privateFromFollowed);
    if (orgConnected) parts.push(orgConnected);
    parts.push(...globalPublic);
    return { $or: parts };
  }

  private async resolveInterestCategoryIds(
    viewerId: string,
  ): Promise<Types.ObjectId[]> {
    const user = await this.usersService.findById(viewerId);
    if (!user?.interests?.length) return [];
    const ids: Types.ObjectId[] = [];
    for (const slug of user.interests) {
      const cat = await this.categoriesService.findBySlug(slug);
      if (cat) ids.push(cat._id);
    }
    return ids;
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
