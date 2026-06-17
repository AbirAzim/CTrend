import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type FixtureDocument = HydratedDocument<Fixture> & {
  createdAt: Date;
  updatedAt: Date;
};

export class MatchEventPlayer {
  id?: number | null;
  name?: string | null;
}

export class MatchEvent {
  time: number;
  timeExtra?: number | null;
  team: string; // 'home' | 'away'
  type: string; // 'Goal' | 'Card' | 'subst'
  detail: string; // 'Normal Goal', 'Own Goal', 'Yellow Card', etc.
  player: MatchEventPlayer;
  assist?: MatchEventPlayer | null;
}

export class MatchLineupPlayer {
  id?: number | null;
  name: string;
  number: number;
  pos?: string | null;
  grid?: string | null;
  photo?: string | null;
}

export class MatchLineupCoach {
  id?: number | null;
  name: string;
  photo?: string | null;
}

export class MatchLineup {
  team: string; // 'home' | 'away'
  formation: string;
  startXI: MatchLineupPlayer[];
  substitutes: MatchLineupPlayer[];
  coach: MatchLineupCoach;
}

export class MatchStat {
  type: string;
  home?: string | null;
  away?: string | null;
}

export class PlayerRating {
  playerId: number;
  name: string;
  team: string; // 'home' | 'away'
  rating?: string | null;
  photo?: string | null;
}

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
  /** API-Football team IDs for resolving home/away in events */
  @Prop({ type: Number, default: null })
  homeTeamExternalId?: number | null;

  @Prop({ type: Number, default: null })
  awayTeamExternalId?: number | null;

  /** Match key events (goals, cards, substitutions) — live-synced */
  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  events: MatchEvent[];

  /** Starting lineups — synced once when available */
  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  lineups: MatchLineup[];

  /** Match statistics pairs (home vs away) */
  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  stats: MatchStat[];

  /** Per-player match ratings */
  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  playerRatings: PlayerRating[];

  /** Timestamp of last events/stats/lineups sync */
  @Prop({ type: Date, default: null })
  detailsSyncedAt?: Date | null;

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
