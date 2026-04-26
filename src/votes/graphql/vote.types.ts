import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';
import { UserGql } from '../../users/graphql/user.types';

@ObjectType()
export class VoteResultGql {
  @Field(() => ID)
  postId: string;

  @Field(() => Int)
  totalVotes: number;

  @Field(() => [Int])
  countsPerOption: number[];

  @Field(() => [Float])
  percentages: number[];
}

@ObjectType()
export class VoteUpdateGql {
  @Field(() => ID)
  postId: string;

  @Field(() => Int)
  totalVotes: number;

  @Field(() => [Int])
  countsPerOption: number[];

  @Field(() => [Float])
  percentages: number[];
}

@ObjectType()
export class PostVoterGql {
  @Field(() => ID)
  voteId: string;

  @Field(() => Int)
  selectedOptionIndex: number;

  @Field()
  anonymous: boolean;

  @Field(() => UserGql, { nullable: true })
  user?: UserGql | null;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}
