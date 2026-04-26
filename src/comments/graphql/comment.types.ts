import { Field, ID, ObjectType } from '@nestjs/graphql';
import { UserGql } from '../../users/graphql/user.types';

@ObjectType()
export class CommentGql {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  postId: string;

  @Field(() => UserGql)
  author: UserGql;

  @Field()
  content: string;

  @Field(() => ID, { nullable: true })
  parentId?: string;

  @Field()
  likeCount: number;

  @Field()
  viewerHasLiked: boolean;

  @Field()
  createdAt: Date;
}
