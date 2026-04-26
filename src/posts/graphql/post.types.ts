import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import {
  OrgPostReach,
  PostType,
  Visibility,
} from '../../common/enums';
import { CategoryGql } from '../../categories/graphql/category.types';
import { UserGql } from '../../users/graphql/user.types';
import { CommentGql } from '../../comments/graphql/comment.types';

@ObjectType()
export class PostOptionGql {
  @Field()
  label: string;

  @Field({ nullable: true })
  imageUrl?: string;
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

  /** Legacy frontend alias: author.username */
  @Field()
  authorUsername: string;

  /** Legacy frontend alias: author.displayName (nullable) */
  @Field(() => String, { nullable: true })
  authorDisplayName?: string | null;

  @Field()
  authorEmail: string;

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

  @Field()
  isVotingOpen: boolean;

  @Field()
  createdAt: Date;
}
