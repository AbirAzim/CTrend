import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FixtureDocument = HydratedDocument<Fixture> & {
  createdAt: Date;
  updatedAt: Date;
};

export class FixtureTeam {
  name: string;
  shortName: string;
  crest: string; // flag/logo image URL
}

export class FixtureScore {
  home: number | null;
  away: number | null;
  winner: string | null; // HOME_TEAM | AWAY_TEAM | DRAW | null
}

export class FixtureVenue {
  name: string;
  city: string;
}

@Schema({ timestamps: true })
export class Fixture {
  @Prop({ type: Number, required: true, unique: true })
  externalId: number;

  @Prop({
    type: { name: String, shortName: String, crest: String },
    required: true,
  })
  homeTeam: FixtureTeam;

  @Prop({
    type: { name: String, shortName: String, crest: String },
    required: true,
  })
  awayTeam: FixtureTeam;

  @Prop({ type: Date, required: true })
  kickoff: Date;

  @Prop({ type: String, required: true })
  status: string;

  /** Live match minute (elapsed) while IN_PLAY/PAUSED; null otherwise. */
  @Prop({ type: Number, default: null })
  minute?: number | null;

  @Prop({ type: String, required: true })
  stage: string;

  @Prop({ type: String })
  group?: string;

  @Prop({ type: Number })
  matchday?: number;

  @Prop({
    type: {
      home: { type: Number, default: null },
      away: { type: Number, default: null },
      winner: { type: String, default: null },
    },
    default: () => ({ home: null, away: null, winner: null }),
  })
  score: FixtureScore;

  @Prop({ type: { name: String, city: String } })
  venue?: FixtureVenue;

  /** Set once a campaign post has been created for this fixture */
  @Prop({ type: Types.ObjectId, ref: 'Post' })
  campaignPostId?: Types.ObjectId;

  /** True when the post was auto-created by the scheduler cron */
  @Prop({ default: false })
  autoScheduled: boolean;

  /** True when the post has a 3rd "Draw" option (group stage only) */
  @Prop({ default: false })
  hasDrawOption: boolean;

  /** Set when fixtures-sync first detects status = FINISHED */
  @Prop({ type: Date, default: null })
  matchEndedAt: Date | null;

  /** matchEndedAt + post.endingSoonLeadMinutes — when the winner is revealed */
  @Prop({ type: Date, default: null })
  winnerScheduledAt: Date | null;
}

export const FixtureSchema = SchemaFactory.createForClass(Fixture);
FixtureSchema.index({ stage: 1, group: 1, kickoff: 1 });
FixtureSchema.index({ winnerScheduledAt: 1, matchEndedAt: 1 });
