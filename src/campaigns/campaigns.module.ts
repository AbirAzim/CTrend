import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Campaign, CampaignSchema } from './campaign.schema';
import { CampaignsService } from './campaigns.service';
import { CampaignsResolver } from './campaigns.resolver';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Campaign.name, schema: CampaignSchema }]),
  ],
  providers: [CampaignsService, CampaignsResolver],
  exports: [CampaignsService],
})
export class CampaignsModule {}
