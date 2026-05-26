import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Campaign } from '../campaigns/campaign.schema';

export type CampaignWinnerDocument = HydratedDocument<CampaignWinner> & {
  createdAt: Date;
  updatedAt: Date;
};

@Schema({ timestamps: true })
export class CampaignWinner {
  /** Which campaign this winner belongs to (optional for backward compat) */
  @Prop({ type: Types.ObjectId, ref: Campaign.name })
  campaignId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Fixture', required: true, unique: true })
  fixtureId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Post', required: true })
  postId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  userId?: Types.ObjectId;

  @Prop({ type: Number, default: 100 })
  prize: number;

  /** Option index the winner voted for (0=home, 1=away) */
  @Prop({ type: Number })
  winningOption?: number;

  /** Admin marks this true after manually sending bKash payment */
  @Prop({ default: false })
  paid: boolean;

  /** Human-readable note, e.g. "No correct votes — no winner" */
  @Prop({ type: String })
  note?: string;
}

export const CampaignWinnerSchema =
  SchemaFactory.createForClass(CampaignWinner);
