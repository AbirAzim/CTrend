/**
 * After winning a match campaign draw, a user cannot win again for this many
 * subsequently processed match posts unless they predict the exact final score.
 */
export const CAMPAIGN_WINNER_COOLDOWN_MATCHES = 4;

/** Draw weight for eligible voters who have never won a campaign match. */
export const CAMPAIGN_WINNER_FIRST_TIME_WEIGHT = 1;

/** Fallback weights when only past winners remain in the pool (no exact score, no never-won). */
export const CAMPAIGN_WINNER_REPEAT_ONCE_WEIGHT = 0.2;

/** Draw weight for voters with 2+ past campaign wins (outside cooldown). */
export const CAMPAIGN_WINNER_REPEAT_MULTI_WEIGHT = 0.08;

/** Default bKash prize for group stage and knockout matches (through quarter-finals). */
export const CAMPAIGN_PRIZE_DEFAULT = 100;

/** bKash prize for a semi-final match winner. */
export const CAMPAIGN_PRIZE_SEMI_FINAL = 500;

/** bKash prize for the World Cup final. */
export const CAMPAIGN_PRIZE_FINAL = 1000;

/** bKash prize for the third-place playoff. */
export const CAMPAIGN_PRIZE_THIRD_PLACE = 200;

/** Cash prize (BDT) for a campaign draw, based on fixture stage. */
export function campaignPrizeForFixtureStage(stage: string | null | undefined): number {
  const s = (stage ?? '').toUpperCase();
  if (s === 'FINAL') return CAMPAIGN_PRIZE_FINAL;
  if (s === 'SEMI_FINALS') return CAMPAIGN_PRIZE_SEMI_FINAL;
  if (s === 'THIRD_PLACE') return CAMPAIGN_PRIZE_THIRD_PLACE;
  return CAMPAIGN_PRIZE_DEFAULT;
}
