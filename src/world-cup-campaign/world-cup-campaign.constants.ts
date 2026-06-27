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
