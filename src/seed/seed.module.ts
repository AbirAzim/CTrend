import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Post, PostSchema } from '../posts/post.schema';
import { User, UserSchema } from '../users/user.schema';
import { CategoriesModule } from '../categories/categories.module';
import { UsersModule } from '../users/users.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { SeedDummyPostsService } from './seed-dummy-posts.service';
import { AdminSeedService } from './admin-seed.service';
import { CampaignSeedService } from './campaign-seed.service';

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
  providers: [SeedDummyPostsService, AdminSeedService, CampaignSeedService],
})
export class SeedModule {}
