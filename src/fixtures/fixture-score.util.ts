/** Parse API-Football fixture score phases for knockout ET / penalties. */

export type ScorePair = { home: number; away: number };

export type ParsedFixtureScores = {
  rawStatus: string;
  /** Main board score (regulation + ET goals, not pen tally). */
  home: number | null;
  away: number | null;
  fullTime: ScorePair | null;
  extraTime: ScorePair | null;
  penalty: ScorePair | null;
  wentToExtraTime: boolean;
  wentToPenalties: boolean;
  /** Score used for exact-score predictions (after ET, before pens). */
  predictionScore: ScorePair | null;
  winner: string | null;
};

type ApiScorePair = { home: number | null; away: number | null } | null | undefined;

export function readScorePair(pair: ApiScorePair): ScorePair | null {
  if (!pair || pair.home == null || pair.away == null) return null;
  return { home: pair.home, away: pair.away };
}

/** 90-minute score plus goals scored only in extra time (API extratime is a delta). */
export function scoreAfterExtraTime(
  fullTime: ScorePair | null,
  extraTime: ScorePair | null,
): ScorePair | null {
  if (!fullTime) return extraTime;
  if (!extraTime) return fullTime;
  return {
    home: fullTime.home + extraTime.home,
    away: fullTime.away + extraTime.away,
  };
}

type ApiFixtureItem = {
  fixture: { status: { short: string } };
  teams: { home: { winner?: boolean | null }; away: { winner?: boolean | null } };
  goals: { home: number | null; away: number | null };
  score?: {
    fulltime?: ApiScorePair;
    extratime?: ApiScorePair;
    penalty?: ApiScorePair;
  };
};

export function parseFixtureScores(
  item: ApiFixtureItem,
  normalizedStatus: string,
): ParsedFixtureScores {
  const rawStatus = item.fixture.status.short;
  const fullTime = readScorePair(item.score?.fulltime);
  const extraTime = readScorePair(item.score?.extratime);
  const penalty = readScorePair(item.score?.penalty);
  const wentToExtraTime = extraTime != null;
  const wentToPenalties = penalty != null;
  const afterExtraTime = scoreAfterExtraTime(fullTime, extraTime);
  const predictionScore = afterExtraTime ?? fullTime ?? readScorePair(item.goals);

  let home = item.goals.home;
  let away = item.goals.away;
  if (afterExtraTime) {
    home = afterExtraTime.home;
    away = afterExtraTime.away;
  } else if (fullTime) {
    home = fullTime.home;
    away = fullTime.away;
  }

  let winner: string | null = null;
  if (normalizedStatus === 'FINISHED') {
    if (item.teams.home.winner) winner = 'HOME_TEAM';
    else if (item.teams.away.winner) winner = 'AWAY_TEAM';
    else if (home != null && away != null) {
      if (home > away) winner = 'HOME_TEAM';
      else if (away > home) winner = 'AWAY_TEAM';
      else winner = 'DRAW';
    }
  }

  return {
    rawStatus,
    home,
    away,
    fullTime,
    extraTime,
    penalty,
    wentToExtraTime,
    wentToPenalties,
    predictionScore,
    winner,
  };
}

export function scorePairFields(prefix: string, pair: ScorePair | null) {
  if (!pair) {
    return {
      [`${prefix}Home`]: null,
      [`${prefix}Away`]: null,
    };
  }
  return {
    [`${prefix}Home`]: pair.home,
    [`${prefix}Away`]: pair.away,
  };
}

export function buildFixtureScoreSet(parsed: ParsedFixtureScores) {
  return {
    rawStatus: parsed.rawStatus,
    wentToExtraTime: parsed.wentToExtraTime,
    wentToPenalties: parsed.wentToPenalties,
    ...scorePairFields('scoreFullTime', parsed.fullTime),
    ...scorePairFields('scoreExtraTime', parsed.extraTime),
    ...scorePairFields('scorePenalty', parsed.penalty),
    score: {
      home: parsed.home,
      away: parsed.away,
      winner: parsed.winner,
    },
  };
}

export function buildPostFixtureScoreSet(parsed: ParsedFixtureScores) {
  return {
    fixtureScore: {
      home: parsed.home,
      away: parsed.away,
      phase: parsed.rawStatus,
      ...scorePairFields('fullTime', parsed.fullTime),
      ...scorePairFields('extraTime', parsed.extraTime),
      ...scorePairFields('penalty', parsed.penalty),
      wentToExtraTime: parsed.wentToExtraTime,
      wentToPenalties: parsed.wentToPenalties,
    },
  };
}

/** Seed / backfill denormalized match fields on a campaign post from a fixture row. */
export function denormalizedPostFieldsFromFixture(fixture: {
  status: string;
  minute?: number | null;
  rawStatus?: string | null;
  stage: string;
  hasDrawOption?: boolean;
  score?: { home?: number | null; away?: number | null } | null;
  scoreFullTimeHome?: number | null;
  scoreFullTimeAway?: number | null;
  scoreExtraTimeHome?: number | null;
  scoreExtraTimeAway?: number | null;
  scorePenaltyHome?: number | null;
  scorePenaltyAway?: number | null;
  wentToExtraTime?: boolean;
  wentToPenalties?: boolean;
}) {
  const isLive = fixture.status === 'IN_PLAY' || fixture.status === 'PAUSED';
  return {
    fixtureStatus: fixture.status,
    fixtureMinute: isLive ? (fixture.minute ?? null) : null,
    fixtureStage: fixture.stage,
    hasDrawOption: fixture.hasDrawOption ?? fixture.stage === 'GROUP_STAGE',
    fixtureScore: {
      home: fixture.score?.home ?? null,
      away: fixture.score?.away ?? null,
      phase: fixture.rawStatus ?? null,
      fullTimeHome: fixture.scoreFullTimeHome ?? null,
      fullTimeAway: fixture.scoreFullTimeAway ?? null,
      extraTimeHome: fixture.scoreExtraTimeHome ?? null,
      extraTimeAway: fixture.scoreExtraTimeAway ?? null,
      penaltyHome: fixture.scorePenaltyHome ?? null,
      penaltyAway: fixture.scorePenaltyAway ?? null,
      wentToExtraTime: fixture.wentToExtraTime ?? false,
      wentToPenalties: fixture.wentToPenalties ?? false,
    },
  };
}

export function isLiveExtraTimePhase(rawStatus?: string | null): boolean {
  const s = (rawStatus ?? '').toUpperCase();
  return s === 'ET' || s === 'BT';
}

export function isLivePenaltyPhase(rawStatus?: string | null): boolean {
  const s = (rawStatus ?? '').toUpperCase();
  return s === 'P' || s === 'PEN';
}
