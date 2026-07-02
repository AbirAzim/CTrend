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

/** 90-minute score plus goals scored only in extra time. */
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

function isLiveFixtureStatus(normalizedStatus: string): boolean {
  return normalizedStatus === 'IN_PLAY' || normalizedStatus === 'PAUSED';
}

/**
 * API-Football `score.extratime` is usually ET-only goals, but during live ET it
 * can briefly mirror the cumulative board (same as `goals`). Adding that to
 * fulltime double-counts (e.g. 1-1 FT + 1-1 "extratime" → false 2-2).
 */
export function normalizeExtraTimeScore(
  fullTime: ScorePair | null,
  apiExtra: ScorePair | null,
  currentGoals: ScorePair | null,
): ScorePair | null {
  if (!apiExtra) return null;
  if (!fullTime || !currentGoals) return apiExtra;

  const summed = scoreAfterExtraTime(fullTime, apiExtra);
  if (!summed) return apiExtra;

  const matchesBoard =
    apiExtra.home === currentGoals.home &&
    apiExtra.away === currentGoals.away;
  const overshootsBoard =
    summed.home > currentGoals.home || summed.away > currentGoals.away;

  if (matchesBoard || overshootsBoard) {
    return {
      home: Math.max(0, currentGoals.home - fullTime.home),
      away: Math.max(0, currentGoals.away - fullTime.away),
    };
  }

  return apiExtra;
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
  const currentGoals = readScorePair(item.goals);
  const extraTime = normalizeExtraTimeScore(
    fullTime,
    readScorePair(item.score?.extratime),
    currentGoals,
  );
  const penalty = readScorePair(item.score?.penalty);
  const wentToExtraTime =
    extraTime != null ||
    isLiveExtraTimePhase(rawStatus) ||
    rawStatus === 'AET';
  const afterExtraTime = scoreAfterExtraTime(fullTime, extraTime);
  const wentToPenalties = computeWentToPenalties(
    rawStatus,
    penalty,
    afterExtraTime,
  );
  const predictionScore = afterExtraTime ?? fullTime ?? currentGoals;

  const isLive = isLiveFixtureStatus(normalizedStatus);
  // Live board score: `goals` is authoritative (API-Football current total).
  let home = item.goals.home;
  let away = item.goals.away;
  if (!isLive) {
    if (afterExtraTime) {
      home = afterExtraTime.home;
      away = afterExtraTime.away;
    } else if (fullTime) {
      home = fullTime.home;
      away = fullTime.away;
    }
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

/**
 * True only when the match was decided on penalty kicks after extra time ended
 * level. ET spot-kick winners (e.g. 120+5) are not shootouts.
 */
export function computeWentToPenalties(
  rawStatus: string,
  penalty: ScorePair | null,
  scoreAfterEt: ScorePair | null,
): boolean {
  if (penalty == null) return false;
  const s = rawStatus.toUpperCase();
  if (s === 'P' || s === 'PEN' || s === 'PENALTIES') return true;
  if (scoreAfterEt && scoreAfterEt.home !== scoreAfterEt.away) return false;
  return true;
}
