import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Post, PostSchema } from '../posts/post.schema';
import { User, UserSchema } from '../users/user.schema';
import { CategoriesModule } from '../categories/categories.module';
import { UsersModule } from '../users/users.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { AdminSeedService } from './admin-seed.service';
import { CampaignSeedService } from './campaign-seed.service';

// NOTE: `SeedDummyPostsService` is intentionally NOT registered here. It used to
// re-create the three demo compare posts (Ronaldo/Messi, iPhone/Android,
// Apu Vai/Mamun Vai) on every startup, so deleting them never stuck. Leaving it
// unregistered disables that seeding permanently.
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: User.name, schema: UserSchema },
    ]),
    CategoriesModule,
    UsersModule,
    CampaignsModule,
  ],
  providers: [AdminSeedService, CampaignSeedService],
})
export class SeedModule {}
