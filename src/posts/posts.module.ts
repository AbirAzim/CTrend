import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Post, PostSchema } from './post.schema';
import { PostReaction, PostReactionSchema } from './post-reaction.schema';
import {
  PostEmojiReaction,
  PostEmojiReactionSchema,
} from './post-emoji-reaction.schema';
import { SavedPost, SavedPostSchema } from './saved-post.schema';
import { Comment, CommentSchema } from '../comments/comment.schema';
import { PostsService } from './posts.service';
import { PostsResolver } from './posts.resolver';
import { PostSchedulerService } from './post-scheduler.service';
import { CategoriesModule } from '../categories/categories.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { UsersModule } from '../users/users.module';
import { VotesModule } from '../votes/votes.module';
import { CommentsModule } from '../comments/comments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FollowsModule } from '../follows/follows.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { MessagesModule } from '../messages/messages.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { ContentReportsModule } from '../content-reports/content-reports.module';
import { WorldCupCampaignModule } from '../world-cup-campaign/world-cup-campaign.module';
import { CoinsModule } from '../coins/coins.module';
import { Fixture, FixtureSchema } from '../fixtures/fixture.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: PostReaction.name, schema: PostReactionSchema },
      { name: PostEmojiReaction.name, schema: PostEmojiReactionSchema },
      { name: SavedPost.name, schema: SavedPostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Fixture.name, schema: FixtureSchema },
    ]),
    CategoriesModule,
    OrganizationsModule,
    UsersModule,
    VotesModule,
    CommentsModule,
    NotificationsModule,
    FollowsModule,
    CampaignsModule,
    MessagesModule,
    PlatformSettingsModule,
    ContentReportsModule,
    WorldCupCampaignModule,
    CoinsModule,
  ],
  providers: [PostsService, PostsResolver, PostSchedulerService],
  exports: [PostsService],
})
export class PostsModule {}
