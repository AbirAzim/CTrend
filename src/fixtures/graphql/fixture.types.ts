import { Field, ID, Int, ObjectType, InputType } from '@nestjs/graphql';

@ObjectType()
export class FixtureDetailsSyncResultGql {
  @Field(() => Int)
  events: number;

  @Field(() => Int)
  stats: number;

  @Field(() => Int)
  lineups: number;

  @Field(() => String, { nullable: true })
  error?: string | null;
}

@ObjectType()
export class MatchEventPlayerGql {
  @Field(() => Int, { nullable: true })
  id?: number | null;

  @Field(() => String, { nullable: true })
  name?: string | null;
}

@ObjectType()
export class MatchEventGql {
  @Field(() => Int)
  time: number;

  @Field(() => Int, { nullable: true })
  timeExtra?: number | null;

  // API-Football occasionally omits these on some events (e.g. substitutions),
  // so keep them nullable to avoid crashing the whole fixture query.
  @Field(() => String, { nullable: true })
  team?: string | null;

  @Field(() => String, { nullable: true })
  type?: string | null;

  @Field(() => String, { nullable: true })
  detail?: string | null;

  @Field(() => MatchEventPlayerGql, { nullable: true })
  player?: MatchEventPlayerGql | null;

  @Field(() => MatchEventPlayerGql, { nullable: true })
  assist?: MatchEventPlayerGql | null;
}

@ObjectType()
export class MatchLineupPlayerGql {
  @Field(() => Int, { nullable: true })
  id?: number | null;

  @Field()
  name: string;

  @Field(() => Int)
  number: number;

  @Field(() => String, { nullable: true })
  pos?: string | null;

  @Field(() => String, { nullable: true })
  grid?: string | null;

  @Field(() => String, { nullable: true })
  photo?: string | null;
}

@ObjectType()
export class MatchLineupCoachGql {
  @Field(() => Int, { nullable: true })
  id?: number | null;

  // API-Football occasionally returns a coach object with no name; keep this
  // nullable so already-stored fixtures don't crash the whole query.
  @Field(() => String, { nullable: true })
  name?: string | null;

  @Field(() => String, { nullable: true })
  photo?: string | null;
}

@ObjectType()
export class MatchLineupGql {
  @Field()
  team: string;

  @Field()
  formation: string;

  @Field(() => [MatchLineupPlayerGql])
  startXI: MatchLineupPlayerGql[];

  @Field(() => [MatchLineupPlayerGql])
  substitutes: MatchLineupPlayerGql[];

  @Field(() => MatchLineupCoachGql, { nullable: true })
  coach?: MatchLineupCoachGql | null;
}

@ObjectType()
export class MatchStatGql {
  @Field()
  type: string;

  @Field(() => String, { nullable: true })
  home?: string | null;

  @Field(() => String, { nullable: true })
  away?: string | null;
}

@ObjectType()
export class PlayerRatingGql {
  @Field(() => Int)
  playerId: number;

  @Field()
  name: string;

  @Field()
  team: string;

  @Field(() => String, { nullable: true })
  rating?: string | null;

  @Field(() => String, { nullable: true })
  photo?: string | null;
}

@ObjectType()
export class PlayerMatchStatGql {
  @Field(() => Int)
  playerId: number;

  @Field()
  name: string;

  @Field()
  team: string;

  @Field(() => String, { nullable: true })
  photo?: string | null;

  @Field(() => Int, { nullable: true })
  number?: number | null;

  @Field(() => String, { nullable: true })
  position?: string | null;

  @Field(() => Int, { nullable: true })
  minutes?: number | null;

  @Field(() => String, { nullable: true })
  rating?: string | null;

  @Field(() => Boolean, { nullable: true })
  captain?: boolean | null;

  @Field(() => Boolean, { nullable: true })
  substitute?: boolean | null;

  @Field(() => Int, { nullable: true })
  goals?: number | null;

  @Field(() => Int, { nullable: true })
  assists?: number | null;

  @Field(() => Int, { nullable: true })
  shotsTotal?: number | null;

  @Field(() => Int, { nullable: true })
  shotsOn?: number | null;

  @Field(() => Int, { nullable: true })
  keyPasses?: number | null;

  @Field(() => Int, { nullable: true })
  passesTotal?: number | null;

  @Field(() => Int, { nullable: true })
  passAccuracy?: number | null;

  @Field(() => Int, { nullable: true })
  dribblesAttempts?: number | null;

  @Field(() => Int, { nullable: true })
  dribblesSuccess?: number | null;

  @Field(() => Int, { nullable: true })
  foulsDrawn?: number | null;

  @Field(() => Int, { nullable: true })
  foulsCommitted?: number | null;

  @Field(() => Int, { nullable: true })
  tacklesTotal?: number | null;

  @Field(() => Int, { nullable: true })
  interceptions?: number | null;

  @Field(() => Int, { nullable: true })
  duelsTotal?: number | null;

  @Field(() => Int, { nullable: true })
  duelsWon?: number | null;

  @Field(() => Int, { nullable: true })
  offsides?: number | null;

  @Field(() => Int, { nullable: true })
  yellow?: number | null;

  @Field(() => Int, { nullable: true })
  red?: number | null;

  @Field(() => Int, { nullable: true })
  penaltyScored?: number | null;

  @Field(() => Int, { nullable: true })
  penaltyMissed?: number | null;

  @Field(() => Int, { nullable: true })
  saves?: number | null;
}

@ObjectType()
export class FixtureTeamGql {
  @Field(() => String, { nullable: true })
  name?: string | null;

  @Field(() => String, { nullable: true })
  shortName?: string | null;

  @Field(() => String, { nullable: true })
  crest?: string | null;
}

@ObjectType()
export class FixtureScoreGql {
  @Field(() => Int, { nullable: true })
  home?: number | null;

  @Field(() => Int, { nullable: true })
  away?: number | null;

  @Field(() => String, { nullable: true })
  winner?: string | null;
}

@ObjectType()
export class FixtureVenueGql {
  @Field()
  name: string;

  @Field()
  city: string;
}

@ObjectType()
export class FixtureGql {
  @Field(() => ID)
  id: string;

  @Field(() => Int)
  externalId: number;

  @Field(() => FixtureTeamGql)
  homeTeam: FixtureTeamGql;

  @Field(() => FixtureTeamGql)
  awayTeam: FixtureTeamGql;

  @Field()
  kickoff: Date;

  @Field()
  status: string;

  @Field(() => Int, { nullable: true })
  minute?: number | null;

  @Field()
  stage: string;

  @Field(() => String, { nullable: true })
  group?: string;

  @Field(() => Int, { nullable: true })
  matchday?: number;

  @Field(() => FixtureScoreGql)
  score: FixtureScoreGql;

  @Field(() => FixtureVenueGql, { nullable: true })
  venue?: FixtureVenueGql;

  /** ID of the campaign post created for this fixture, if any */
  @Field(() => ID, { nullable: true })
  campaignPostId?: string;

  @Field()
  autoScheduled: boolean;

  @Field()
  hasDrawOption: boolean;

  @Field(() => Date, { nullable: true })
  matchEndedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  winnerScheduledAt?: Date | null;

  @Field(() => [MatchEventGql])
  events: MatchEventGql[];

  @Field(() => [MatchLineupGql])
  lineups: MatchLineupGql[];

  @Field(() => [MatchStatGql])
  stats: MatchStatGql[];

  @Field(() => [PlayerRatingGql])
  playerRatings: PlayerRatingGql[];

  @Field(() => [PlayerMatchStatGql])
  playerMatchStats: PlayerMatchStatGql[];

  @Field(() => Date, { nullable: true })
  detailsSyncedAt?: Date | null;
}

@InputType()
export class FixtureFilterInput {
  @Field(() => String, { nullable: true })
  stage?: string;

  @Field(() => String, { nullable: true })
  group?: string;
}

@ObjectType()
export class TopScorerGql {
  @Field(() => Int, { nullable: true })
  playerId?: number | null;

  @Field()
  name: string;

  @Field()
  team: string;

  @Field(() => String, { nullable: true })
  teamCrest?: string | null;

  @Field(() => Int)
  goals: number;

  @Field(() => Int)
  matchesPlayed: number;
}

@ObjectType()
export class TopAssistantGql {
  @Field(() => Int, { nullable: true })
  playerId?: number | null;

  @Field()
  name: string;

  @Field()
  team: string;

  @Field(() => String, { nullable: true })
  teamCrest?: string | null;

  @Field(() => Int)
  assists: number;

  @Field(() => Int)
  matchesPlayed: number;
}
