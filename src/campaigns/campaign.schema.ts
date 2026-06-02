import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CampaignDocument = HydratedDocument<Campaign> & {
  createdAt: Date;
  updatedAt: Date;
};

@Schema({ timestamps: true })
export class Campaign {
  /** Display name, e.g. "World Cup Fever 2026" */
  @Prop({ type: String, required: true, trim: true })
  name: string;

  /** URL-safe identifier, e.g. "world-cup-2026". Unique. */
  @Prop({
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  })
  slug: string;

  @Prop({ type: String, trim: true })
  description?: string;

  /** Short promo text shown on the feed banner */
  @Prop({ type: String, required: true, trim: true })
  bannerText: string;

  /** Optional hero/background image URL for the banner */
  @Prop({ type: String })
  bannerImageUrl?: string;

  /** Button label on the banner, e.g. "World Cup 2026" */
  @Prop({ type: String, required: true, trim: true })
  ctaLabel: string;

  /** Frontend route this campaign links to, e.g. "/world-cup" */
  @Prop({ type: String, required: true, trim: true })
  ctaUrl: string;

  /** Whether the campaign is currently live and shown to users */
  @Prop({ default: false })
  isActive: boolean;

  /** Admin-selected default campaign shown first in listings. */
  @Prop({ default: false })
  isDefault: boolean;

  /** Prize per winner in BDT */
  @Prop({ type: Number, default: 100 })
  prizePerWinner: number;

  /** Plain-text rules shown on the campaign detail page (English) */
  @Prop({ type: String })
  rules?: string;

  /** Plain-text rules in Bengali */
  @Prop({ type: String })
  rulesBn?: string;

  /** If true, the campaign detail page renders the World Cup fixture list */
  @Prop({ default: false })
  fixturesEnabled: boolean;

  @Prop({ type: Date })
  startDate?: Date;

  @Prop({ type: Date })
  endDate?: Date;
}

export const CampaignSchema = SchemaFactory.createForClass(Campaign);
CampaignSchema.index({ isActive: 1 });
CampaignSchema.index({ isDefault: 1 });
