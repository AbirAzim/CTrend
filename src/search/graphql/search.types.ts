import { Field, ObjectType } from '@nestjs/graphql';
import { UserGql } from '../../users/graphql/user.types';
import { PostGql } from '../../posts/graphql/post.types';

@ObjectType()
export class SearchUserGql {
  @Field(() => UserGql)
  user: UserGql;

  /** True when this user is a confirmed friend of the viewer. */
  @Field()
  isFriend: boolean;
}

@ObjectType()
export class SearchResultGql {
  @Field(() => [SearchUserGql])
  users: SearchUserGql[];

  @Field(() => [PostGql])
  posts: PostGql[];
}
