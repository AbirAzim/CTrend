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
      aImage: string;
      bImage: string;
    }> = [
      {
        a: 'Cristiano Ronaldo',
        b: 'Lionel Messi',
        contentText:
          'CR7 vs Messi — who is the GOAT? Cast your vote on this all-time classic rivalry.',
        categorySlug: 'sports',
        // Wikimedia Commons — File:Cristiano_Ronaldo_2018.jpg, File:Lionel_Messi_2018.jpg
        aImage:
          'https://upload.wikimedia.org/wikipedia/commons/8/8c/Cristiano_Ronaldo_2018.jpg',
        bImage:
          'https://upload.wikimedia.org/wikipedia/commons/b/b0/Lionel_Messi_2018.jpg',
      },
      {
        a: 'iPhone',
        b: 'Android',
        contentText: 'iPhone vs Android — which ecosystem do you prefer?',
        categorySlug: 'tech',
        aImage:
          'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?auto=format&fit=crop&w=800&q=80',
        bImage:
          'https://images.unsplash.com/photo-1598327105666-5b89351aff97?auto=format&fit=crop&w=800&q=80',
      },
      {
        a: 'Apu Vai',
        b: 'Mamun Vai',
        contentText: 'Apu Vai vs Mamun Vai — pick your favorite!',
        categorySlug: 'entertainment',
        aImage:
          'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80',
        bImage:
          'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=800&q=80',
      },
    ];

    for (const t of templates) {
      const existing = await this.postModel.findOne({
        createdBy: authorId,
        'options.0.label': t.a,
        'options.1.label': t.b,
      });
      if (existing) {
        const postImageCount = existing.imageUrls?.length ?? 0;
        const needsTwoPostImages = postImageCount < 2;
        const needsOptionImages =
          !existing.options?.[0]?.imageUrl || !existing.options?.[1]?.imageUrl;
        const hadLegacyMessiPortrait =
          existing.options?.[1]?.label === 'Lionel Messi' &&
          !!existing.options[1].imageUrl?.includes('Portrait_of_Lionel_Messi');
        if (needsTwoPostImages || needsOptionImages || hadLegacyMessiPortrait) {
          existing.imageUrls = [t.aImage, t.bImage];
          existing.options = [
            {
              ...existing.options[0],
              label: existing.options[0]?.label ?? t.a,
              imageUrl: t.aImage,
            },
            {
              ...existing.options[1],
              label: existing.options[1]?.label ?? t.b,
              imageUrl: t.bImage,
            },
          ];
          await existing.save();
          this.logger.log(`Updated images for seed post: ${t.a} vs ${t.b}`);
        }
        continue;
      }

      const cat = await this.categoriesService.findBySlug(t.categorySlug);
      if (!cat) {
        this.logger.warn(`Category ${t.categorySlug} missing, skip: ${t.a} vs ${t.b}`);
        continue;
      }

      await this.postModel.create({
        type: PostType.USER,
        contentText: t.contentText,
        imageUrls: [t.aImage, t.bImage],
        options: [
          { label: t.a, imageUrl: t.aImage },
          { label: t.b, imageUrl: t.bImage },
        ],
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
