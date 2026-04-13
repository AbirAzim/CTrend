import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

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
