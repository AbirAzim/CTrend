import {
  normalizeExtraTimeScore,
  parseFixtureScores,
  scoreAfterExtraTime,
} from './fixture-score.util';

describe('normalizeExtraTimeScore', () => {
  it('treats extratime matching goals as cumulative (no double-count)', () => {
    const fullTime = { home: 1, away: 1 };
    const apiExtra = { home: 1, away: 1 };
    const goals = { home: 1, away: 1 };
    expect(normalizeExtraTimeScore(fullTime, apiExtra, goals)).toEqual({
      home: 0,
      away: 0,
    });
    expect(scoreAfterExtraTime(fullTime, normalizeExtraTimeScore(fullTime, apiExtra, goals))).toEqual(
      goals,
    );
  });

  it('keeps true ET deltas when sum matches goals', () => {
    const fullTime = { home: 1, away: 1 };
    const apiExtra = { home: 1, away: 0 };
    const goals = { home: 2, away: 1 };
    expect(normalizeExtraTimeScore(fullTime, apiExtra, goals)).toEqual(apiExtra);
  });
});

describe('parseFixtureScores', () => {
  const baseItem = {
    fixture: { status: { short: 'ET' } },
    teams: { home: { winner: null }, away: { winner: null } },
    goals: { home: 1, away: 1 },
    score: {
      fulltime: { home: 1, away: 1 },
      extratime: { home: 1, away: 1 },
    },
  };

  it('does not flash 2-2 when live ET board is 1-1', () => {
    const parsed = parseFixtureScores(baseItem, 'IN_PLAY');
    expect(parsed.home).toBe(1);
    expect(parsed.away).toBe(1);
    expect(parsed.extraTime).toEqual({ home: 0, away: 0 });
    expect(parsed.wentToExtraTime).toBe(true);
  });

  it('uses FT+ET total when match is finished after extra time', () => {
    const parsed = parseFixtureScores(
      {
        ...baseItem,
        fixture: { status: { short: 'AET' } },
        goals: { home: 2, away: 1 },
        score: {
          fulltime: { home: 1, away: 1 },
          extratime: { home: 1, away: 0 },
        },
      },
      'FINISHED',
    );
    expect(parsed.home).toBe(2);
    expect(parsed.away).toBe(1);
  });
});
