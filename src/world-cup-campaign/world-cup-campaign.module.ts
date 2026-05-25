import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CampaignWinner,
  CampaignWinnerSchema,
} from './campaign-winner.schema';
import { Fixture, FixtureSchema } from '../fixtures/fixture.schema';
import { Vote, VoteSchema } from '../votes/vote.schema';
import { WorldCupCampaignService } from './world-cup-campaign.service';
import { WorldCupCampaignResolver } from './world-cup-campaign.resolver';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CampaignWinner.name, schema: CampaignWinnerSchema },
      { name: Fixture.name, schema: FixtureSchema },
      { name: Vote.name, schema: VoteSchema },
    ]),
    UsersModule,
  ],
  providers: [WorldCupCampaignService, WorldCupCampaignResolver],
  exports: [WorldCupCampaignService],
})
export class WorldCupCampaignModule {}
