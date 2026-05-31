import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/user.schema';
import { Post, PostDocument } from '../posts/post.schema';
import { UsersService } from '../users/users.service';
import { PostsService } from '../posts/posts.service';
import { FollowsService } from '../follows/follows.service';
import { PostStatus } from '../common/enums';
import { SearchResultGql, SearchUserGql } from './graphql/search.types';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class SearchService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    private usersService: UsersService,
    private postsService: PostsService,
    private followsService: FollowsService,
  ) {}

  async globalSearch(
    viewerId: string | undefined,
    rawQuery: string,
    limit = 20,
  ): Promise<SearchResultGql> {
    const q = rawQuery.trim();
    if (!q) return { users: [], posts: [] };
    const cappedLimit = Math.max(1, Math.min(limit, 50));
    const re = new RegExp(escapeRegex(q), 'i');

    // ── USERS ────────────────────────────────────────────────────────
    // Friends first, then everyone else. Exclude the viewer themselves.
    let friendIds: Set<string> = new Set();
    if (viewerId) {
      try {
        const friends = await this.followsService.getMyFriends(viewerId);
        friendIds = new Set(friends.map((f) => f.id));
      } catch {
        // Non-fatal — fall through to a viewer-less search.
      }
    }

    const userFilter: Record<string, unknown> = {
      $or: [{ displayName: re }, { username: re }, { email: re }],
    };
    if (viewerId) {
      userFilter._id = { $ne: new Types.ObjectId(viewerId) };
    }

    const userDocs = await this.userModel
      .find(userFilter)
      .limit(cappedLimit * 2) // wider net so we can re-sort with friends first
      .exec();

    const userResults: SearchUserGql[] = userDocs.map((u) => ({
      user: this.usersService.toGql(u),
      isFriend: friendIds.has((u._id as Types.ObjectId).toHexString()),
    }));

    // Friends first, then alphabetical by displayName/username
    userResults.sort((a, b) => {
      if (a.isFriend !== b.isFriend) return a.isFriend ? -1 : 1;
      const an = (a.user.displayName ?? a.user.username ?? '').toLowerCase();
      const bn = (b.user.displayName ?? b.user.username ?? '').toLowerCase();
      return an.localeCompare(bn);
    });

    const usersOut = userResults.slice(0, cappedLimit);

    // ── POSTS ────────────────────────────────────────────────────────
    // Match captions (contentText) and option labels. Only PUBLISHED posts.
    const postDocs = await this.postModel
      .find({
        status: { $ne: PostStatus.SCHEDULED },
        $or: [{ contentText: re }, { 'options.label': re }],
      })
      .sort({ createdAt: -1 })
      .limit(cappedLimit)
      .exec();

    const posts = await Promise.all(
      postDocs.map((p) => this.postsService.toGql(p, viewerId)),
    );

    return { users: usersOut, posts };
  }
}
