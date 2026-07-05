/** All coin-earning event types. The string value is stored in the ledger. */
export const CoinType = {
  HYPE: 'HYPE', // you hyped a post
  VOTE: 'VOTE', // you voted on a post
  PREDICTION: 'PREDICTION', // you made a match prediction
  POST: 'POST', // you created a post
  COMMENT: 'COMMENT', // you commented on a post
  POST_HYPED: 'POST_HYPED', // someone hyped your post
  POST_VOTED: 'POST_VOTED', // someone voted on your post
  PREDICTION_CORRECT: 'PREDICTION_CORRECT', // your exact-score prediction won
  CAMPAIGN_WINNER: 'CAMPAIGN_WINNER', // you were drawn as a campaign/match winner
  VOTE_WINNER: 'VOTE_WINNER', // you were drawn as a post vote winner
  DAILY_STREAK: 'DAILY_STREAK', // first activity of the day
  INVITE: 'INVITE', // an invited friend joined
  REFERRAL_INVITEE: 'REFERRAL_INVITEE', // joined via a friend's referral code
} as const;

export type CoinTypeValue = (typeof CoinType)[keyof typeof CoinType];

/** Coins granted per event type. */
export const COIN_AMOUNTS: Record<CoinTypeValue, number> = {
  HYPE: 5,
  VOTE: 10,
  PREDICTION: 15,
  POST: 20,
  COMMENT: 1,
  POST_HYPED: 2,
  POST_VOTED: 2,
  PREDICTION_CORRECT: 25,
  CAMPAIGN_WINNER: 25,
  VOTE_WINNER: 15,
  DAILY_STREAK: 5,
  INVITE: 10,
  REFERRAL_INVITEE: 5,
};
