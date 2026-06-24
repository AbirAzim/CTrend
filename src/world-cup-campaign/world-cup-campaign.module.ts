import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CampaignWinner, CampaignWinnerSchema } from './campaign-winner.schema';
import { Fixture, FixtureSchema } from '../fixtures/fixture.schema';
import { Vote, VoteSchema } from '../votes/vote.schema';
import { Post, PostSchema } from '../posts/post.schema';
import {
  MatchPrediction,
  MatchPredictionSchema,
} from '../match-predictions/match-prediction.schema';
import { WorldCupCampaignService } from './world-cup-campaign.service';
import { WinnerAnnouncementService } from './winner-announcement.service';
import { WorldCupCampaignResolver } from './world-cup-campaign.resolver';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CoinsModule } from '../coins/coins.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CampaignWinner.name, schema: CampaignWinnerSchema },
      { name: Fixture.name, schema: FixtureSchema },
      { name: Vote.name, schema: VoteSchema },
      { name: Post.name, schema: PostSchema },
      { name: MatchPrediction.name, schema: MatchPredictionSchema },
    ]),
    UsersModule,
    NotificationsModule,
    CoinsModule,
  ],
  providers: [
    WorldCupCampaignService,
    WinnerAnnouncementService,
    WorldCupCampaignResolver,
  ],
  exports: [WorldCupCampaignService],
})
export class WorldCupCampaignModule {}
