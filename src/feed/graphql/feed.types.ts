import { Field, Int, ObjectType } from '@nestjs/graphql';
import { PostGql } from '../../posts/graphql/post.types';

@ObjectType()
export class FeedConnectionGql {
  @Field(() => [PostGql])
  nodes: PostGql[];

  @Field(() => Int)
  totalCount: number;
}
