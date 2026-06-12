import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Fixture, FixtureSchema } from './fixture.schema';
import { Post, PostSchema } from '../posts/post.schema';
import { Category, CategorySchema } from '../categories/category.schema';
import { FixturesService } from './fixtures.service';
import { FixturesSyncService } from './fixtures-sync.service';
import { FixturesAutoScheduleService } from './fixtures-auto-schedule.service';
import { FixturesResolver } from './fixtures.resolver';
import { PostsModule } from '../posts/posts.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Fixture.name, schema: FixtureSchema },
      { name: Post.name, schema: PostSchema },
      { name: Category.name, schema: CategorySchema },
    ]),
    PostsModule,
    CampaignsModule,
    UsersModule,
  ],
  providers: [
    FixturesService,
    FixturesSyncService,
    FixturesAutoScheduleService,
    FixturesResolver,
  ],
  exports: [FixturesService],
})
export class FixturesModule {}
