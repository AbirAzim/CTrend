import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import {
  OrgPostReach,
  PostType,
  Visibility,
} from '../../common/enums';
import { CategoryGql } from '../../categories/graphql/category.types';
import { UserGql } from '../../users/graphql/user.types';

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

  @Field(() => OrgPostReach, { nullable: true })
  orgReach?: OrgPostReach;

  @Field()
  commentsDisabled: boolean;

  @Field()
  likesDisabled: boolean;

  @Field(() => Int)
  totalVotes: number;

  @Field(() => [VoteOptionStatGql])
  optionStats: VoteOptionStatGql[];

  @Field(() => Int, { nullable: true })
  mySelectedOptionIndex?: number;

  @Field()
  createdAt: Date;
}
