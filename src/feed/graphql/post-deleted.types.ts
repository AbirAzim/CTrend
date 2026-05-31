import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class PostDeletedGql {
  @Field(() => ID)
  postId: string;
}
