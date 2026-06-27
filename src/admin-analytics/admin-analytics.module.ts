import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/user.schema';
import { Post, PostSchema } from '../posts/post.schema';
import { Vote, VoteSchema } from '../votes/vote.schema';
import { Comment, CommentSchema } from '../comments/comment.schema';
import { Invitation, InvitationSchema } from '../invitations/invitation.schema';
import {
  ContentReport,
  ContentReportSchema,
} from '../content-reports/content-report.schema';
import {
  CampaignWinner,
  CampaignWinnerSchema,
} from '../world-cup-campaign/campaign-winner.schema';
import { PresenceModule } from '../presence/presence.module';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminAnalyticsResolver } from './admin-analytics.resolver';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Post.name, schema: PostSchema },
      { name: Vote.name, schema: VoteSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Invitation.name, schema: InvitationSchema },
      { name: ContentReport.name, schema: ContentReportSchema },
      { name: CampaignWinner.name, schema: CampaignWinnerSchema },
    ]),
    PresenceModule,
  ],
  providers: [AdminAnalyticsService, AdminAnalyticsResolver],
  exports: [AdminAnalyticsService],
})
export class AdminAnalyticsModule {}
