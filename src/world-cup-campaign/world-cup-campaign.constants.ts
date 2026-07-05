/**
 * After winning a match campaign draw, a user cannot win the very next
 * processed match post (strict consecutive-win block). Only applies when
 * there's an actual choice between 2+ correct candidates — a lone correct
 * candidate always wins regardless of cooldown.
 */
export const CAMPAIGN_WINNER_COOLDOWN_MATCHES = 1;

/** Draw-weight multiplier for candidates at/above the pool's average coin balance. */
export const CAMPAIGN_WINNER_ABOVE_AVG_COINS_WEIGHT = 2;

/** Draw-weight multiplier for candidates below the pool's average coin balance. */
export const CAMPAIGN_WINNER_BELOW_AVG_COINS_WEIGHT = 1;

/** Draw-weight multiplier applied when a candidate has no profile picture. */
export const CAMPAIGN_WINNER_NO_PICTURE_WEIGHT_MULTIPLIER = 0.5;

/** Default bKash prize for group stage and knockout matches (through quarter-finals). */
export const CAMPAIGN_PRIZE_DEFAULT = 100;

/** bKash prize for a semi-final match winner. */
export const CAMPAIGN_PRIZE_SEMI_FINAL = 500;

/** bKash prize for the World Cup final. */
export const CAMPAIGN_PRIZE_FINAL = 1000;

/** bKash prize for the third-place playoff. */
export const CAMPAIGN_PRIZE_THIRD_PLACE = 200;

/** Cash prize (BDT) for a campaign draw, based on fixture stage. */
export function campaignPrizeForFixtureStage(
  stage: string | null | undefined,
): number {
  const s = (stage ?? '').toUpperCase();
  if (s === 'FINAL') return CAMPAIGN_PRIZE_FINAL;
  if (s === 'SEMI_FINALS') return CAMPAIGN_PRIZE_SEMI_FINAL;
  if (s === 'THIRD_PLACE') return CAMPAIGN_PRIZE_THIRD_PLACE;
  return CAMPAIGN_PRIZE_DEFAULT;
}
