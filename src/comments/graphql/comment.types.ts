import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { UserGql } from '../../users/graphql/user.types';

@ObjectType()
export class CommentReactionCountGql {
  @Field()
  emoji: string;

  @Field(() => Int)
  count: number;
}

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

  @Field(() => [CommentReactionCountGql])
  reactions: CommentReactionCountGql[];

  @Field({ nullable: true })
  viewerReaction?: string;

  /** @deprecated use reactions */
  @Field()
  likeCount: number;

  /** @deprecated use viewerReaction */
  @Field()
  viewerHasLiked: boolean;

  @Field()
  createdAt: Date;
}
