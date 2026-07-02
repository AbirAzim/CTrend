import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import {
  OrgPostReach,
  PostFormat,
  CompareLayout,
  PostStatus,
  PostType,
  Visibility,
} from '../../common/enums';
import { CategoryGql } from '../../categories/graphql/category.types';
import { UserGql } from '../../users/graphql/user.types';
import { CommentGql } from '../../comments/graphql/comment.types';
import { PostCampaignSummaryGql } from './post-campaign-summary.types';
import { PostVoteWinnerGql } from './post-vote-winner.types';
import { CampaignWinnerGql } from '../../world-cup-campaign/graphql/campaign-winner.types';

/** Pair of home/away integers (score line). */
@ObjectType()
export class ScorePairGql {
  @Field(() => Int, { nullable: true })
  home?: number | null;

  @Field(() => Int, { nullable: true })
  away?: number | null;
}

/** Live/final score for match-type campaign posts. */
@ObjectType()
export class MatchScoreGql {
  @Field(() => Int, { nullable: true })
  home: number | null;

  @Field(() => Int, { nullable: true })
  away: number | null;

  /** TIMED | IN_PLAY | PAUSED | FINISHED */
  @Field(() => String, { nullable: true })
  status: string | null;

  /** Elapsed match minute (IN_PLAY / PAUSED only; null otherwise). */
  @Field(() => Int, { nullable: true })
  minute: number | null;

  /** Raw API phase: ET, P, AET, PEN, 1H, etc. */
  @Field(() => String, { nullable: true })
  phase?: string | null;

  @Field(() => ScorePairGql, { nullable: true })
  fullTime?: ScorePairGql | null;

  @Field(() => ScorePairGql, { nullable: true })
  extraTime?: ScorePairGql | null;

  @Field(() => ScorePairGql, { nullable: true })
  penalty?: ScorePairGql | null;

  @Field(() => Boolean, { nullable: true })
  wentToExtraTime?: boolean | null;

  @Field(() => Boolean, { nullable: true })
  wentToPenalties?: boolean | null;
}

@ObjectType()
export class PostOptionGql {
  @Field()
  label: string;

  @Field({ nullable: true })
  imageUrl?: string;

  @Field(() => Int, { nullable: true })
  imageFocalX?: number;

  @Field(() => Int, { nullable: true })
  imageFocalY?: number;
}

@ObjectType()
export class VoteOptionStatGql {
  @Field(() => Int)
  index: number;

  @Field()
  label: string;

  @Field()
  count: number;

  @Field()
  percentage: number;
}

@ObjectType()
export class PostGql {
  @Field(() => ID)
  id: string;

  @Field(() => PostType)
  type: PostType;

  /** Voting layout: `compare` (image grid) or `poll` (stacked rows). */
  @Field(() => PostFormat)
  format: PostFormat;

  /** Two-image compare: side-by-side (default) or stacked vertically. */
  @Field(() => CompareLayout)
  compareLayout: CompareLayout;

  @Field({ nullable: true })
  contentText?: string;

  @Field(() => [String])
  imageUrls: string[];

  @Field(() => [PostOptionGql])
  options: PostOptionGql[];

  @Field(() => CategoryGql)
  category: CategoryGql;

  @Field(() => Visibility)
  visibility: Visibility;

  @Field(() => UserGql)
  author: UserGql;

  /** Legacy frontend alias: author.id */
  @Field(() => ID)
  authorId: string;

  /** Legacy frontend alias: author.username */
  @Field()
  authorUsername: string;

  /** Legacy frontend alias: author.displayName (nullable) */
  @Field(() => String, { nullable: true })
  authorDisplayName?: string | null;

  @Field(() => String, { nullable: true })
  authorEmail?: string | null;

  /** Legacy frontend alias: author.profileImageUrl (nullable) */
  @Field(() => String, { nullable: true })
  authorProfileImageUrl?: string | null;

  @Field(() => OrgPostReach, { nullable: true })
  orgReach?: OrgPostReach;

  @Field()
  commentsDisabled: boolean;

  @Field()
  likesDisabled: boolean;

  @Field(() => Int)
  commentCount: number;

  @Field(() => Int)
  likeCount: number;

  @Field(() => Int)
  hypeCount: number;

  @Field(() => Int)
  saveCount: number;

  @Field()
  viewerHasSaved: boolean;

  @Field()
  viewerHasHyped: boolean;

  @Field(() => [CommentGql])
  recentComments: CommentGql[];

  @Field(() => Int)
  totalVotes: number;

  /** Legacy frontend alias: first option vote count */
  @Field(() => Int)
  upvoteCount: number;

  /** Legacy frontend alias: second option vote count */
  @Field(() => Int)
  downvoteCount: number;

  @Field(() => [VoteOptionStatGql])
  optionStats: VoteOptionStatGql[];

  @Field(() => Int, { nullable: true })
  mySelectedOptionIndex?: number;

  /** Whether the viewer's vote on this post is anonymous (null if not voted). */
  @Field(() => Boolean, { nullable: true })
  myVoteAnonymous?: boolean | null;

  /** Legacy frontend alias: "up" | "down" | null */
  @Field(() => String, { nullable: true })
  viewerVote?: string | null;

  /** Legacy frontend alias for contentText */
  @Field(() => String, { nullable: true })
  caption?: string;

  /** Legacy frontend alias for first image URL */
  @Field(() => String, { nullable: true })
  imageUrl?: string;

  @Field(() => Date, { nullable: true })
  votingEndsAt?: Date;

  @Field(() => Int)
  endingSoonLeadMinutes: number;

  @Field()
  isVotingOpen: boolean;

  @Field()
  createdAt: Date;

  @Field(() => PostStatus)
  status: PostStatus;

  @Field(() => Date, { nullable: true })
  scheduledAt?: Date;

  @Field(() => Date, { nullable: true })
  updatedAt?: Date;

  /** Admins who edited this post (admin post management). */
  @Field(() => [UserGql], { nullable: true })
  editedBy?: UserGql[];

  @Field(() => UserGql, { nullable: true })
  lastEditedBy?: UserGql;

  @Field(() => PostCampaignSummaryGql, { nullable: true })
  campaign?: PostCampaignSummaryGql | null;

  @Field(() => PostVoteWinnerGql, { nullable: true })
  voteWinner?: PostVoteWinnerGql | null;

  @Field()
  isPrizeClaimed: boolean;

  @Field(() => Date, { nullable: true })
  votePrizeClaimedAt?: Date;

  @Field()
  canClaimPrize: boolean;

  /** True when a normal user posted platform-wide (not admin SYSTEM). */
  @Field()
  isUserGlobalBroadcast: boolean;

  /** Number of user-submitted content reports (admin moderation). */
  @Field(() => Int)
  reportCount: number;

  /** Set after the match ends and the winner countdown completes (campaign posts only). */
  @Field(() => CampaignWinnerGql, { nullable: true })
  campaignWinner?: CampaignWinnerGql | null;

  /**
   * True for fixture-linked match posts (auto-scheduled World Cup posts).
   * The winner is declared from correct predictors after the real match ends,
   * not at votingEndsAt. voteWinner is always null for matchType posts.
   */
  @Field()
  matchType: boolean;

  /** Live/final score — populated for matchType posts only; null for regular posts. */
  @Field(() => MatchScoreGql, { nullable: true })
  matchScore?: MatchScoreGql | null;

  /** When the campaign winner will be revealed after match ends. Null until match finishes. */
  @Field(() => Date, { nullable: true })
  fixtureWinnerAt?: Date | null;

  /** Linked Fixture document id (matchType posts only). */
  @Field(() => String, { nullable: true })
  fixtureId?: string | null;

  /** World Cup round label key (matchType posts only). */
  @Field(() => String, { nullable: true })
  fixtureStage?: string | null;

  /** True when this match post includes a Draw vote option (group stage). */
  @Field()
  hasDrawOption: boolean;

  /** True once lineups are synced — gates the "See Details → Lineups" button. */
  @Field()
  lineupAvailable: boolean;

  /** True when an admin has pinned this post to the top of the feed. */
  @Field()
  pinned: boolean;
}
