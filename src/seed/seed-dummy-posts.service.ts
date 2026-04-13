import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { Post, PostDocument } from '../posts/post.schema';
import { User, UserDocument } from '../users/user.schema';
import { CategoriesService } from '../categories/categories.service';
import { PostType, Visibility } from '../common/enums';

const DEMO_USER_EMAIL = 'ctrend.demo@seed.local';
const DEMO_USERNAME = 'ctrend_demo_feed';

@Injectable()
export class SeedDummyPostsService implements OnModuleInit {
  private readonly logger = new Logger(SeedDummyPostsService.name);

  constructor(
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private categoriesService: CategoriesService,
  ) {}

  async onModuleInit() {
    if (process.env.SKIP_DUMMY_POSTS === 'true') {
      this.logger.log('SKIP_DUMMY_POSTS=true — skipping demo posts');
      return;
    }
    const allowProd = process.env.SEED_DUMMY_POSTS === 'true';
    if (process.env.NODE_ENV === 'production' && !allowProd) {
      return;
    }
    try {
      await this.seed();
    } catch (e) {
      this.logger.error(
        'Demo post seed failed',
        e instanceof Error ? e.stack : String(e),
      );
    }
  }

  private async seed() {
    const authorId = await this.getFirstUserIdOrCreateDemo();
    const templates: Array<{
      a: string;
      b: string;
      contentText: string;
      categorySlug: string;
    }> = [
      {
        a: 'Cristiano Ronaldo',
        b: 'Lionel Messi',
        contentText:
          'CR7 vs Messi — who is the GOAT? Cast your vote on this all-time classic rivalry.',
        categorySlug: 'sports',
      },
      {
        a: 'iPhone',
        b: 'Android',
        contentText: 'iPhone vs Android — which ecosystem do you prefer?',
        categorySlug: 'tech',
      },
      {
        a: 'Apu Vai',
        b: 'Mamun Vai',
        contentText: 'Apu Vai vs Mamun Vai — pick your favorite!',
        categorySlug: 'entertainment',
      },
    ];

    for (const t of templates) {
      const dup = await this.postModel.exists({
        createdBy: authorId,
        'options.0.label': t.a,
        'options.1.label': t.b,
      });
      if (dup) continue;

      const cat = await this.categoriesService.findBySlug(t.categorySlug);
      if (!cat) {
        this.logger.warn(`Category ${t.categorySlug} missing, skip: ${t.a} vs ${t.b}`);
        continue;
      }

      await this.postModel.create({
        type: PostType.USER,
        contentText: t.contentText,
        imageUrls: [],
        options: [{ label: t.a }, { label: t.b }],
        categoryId: cat._id,
        visibility: Visibility.PUBLIC,
        createdBy: authorId,
        feedPriority: 0,
        voteCount: 0,
        commentsDisabled: false,
        likesDisabled: false,
      });
      this.logger.log(`Seeded vote post: ${t.a} vs ${t.b}`);
    }
  }

  private async getFirstUserIdOrCreateDemo(): Promise<Types.ObjectId> {
    const first = await this.userModel.findOne().sort({ createdAt: 1 }).exec();
    if (first) return first._id;

    // No users exist yet; create a local demo author so the feed can show posts.
    const hash = await bcrypt.hash(
      'demo-not-for-login-' + Math.random().toString(36),
      10,
    );
    const user = await this.userModel.create({
      username: DEMO_USERNAME,
      email: DEMO_USER_EMAIL,
      password: hash,
      displayName: 'CTrend Demo Feed',
      interests: ['sports', 'tech', 'entertainment'],
    });
    this.logger.log(`Created demo author ${DEMO_USER_EMAIL}`);
    return user._id;
  }
}
