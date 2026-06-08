import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import {
  OrgPostReach,
  PostFormat,
  PostStatus,
  PostType,
  Visibility,
} from '../../common/enums';
import { CategoryGql } from '../../categories/graphql/category.types';
import { UserGql } from '../../users/graphql/user.types';
import { CommentGql } from '../../comments/graphql/comment.types';
import { PostCampaignSummaryGql } from './post-campaign-summary.types';
import { PostVoteWinnerGql } from './post-vote-winner.types';

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
}
