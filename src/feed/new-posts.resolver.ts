import { Resolver, Subscription } from '@nestjs/graphql';
import { pubsub, NEW_POST, POST_DELETED } from '../pubsub';
import { NewPostGql } from './graphql/new-post.types';
import { PostDeletedGql } from './graphql/post-deleted.types';

@Resolver()
export class NewPostsResolver {
  @Subscription(() => NewPostGql, {
    resolve: (payload: { newPost: NewPostGql }) => payload.newPost,
  })
  newPosts() {
    return pubsub.asyncIterableIterator(NEW_POST);
  }

  @Subscription(() => PostDeletedGql, {
    resolve: (payload: { postDeleted: PostDeletedGql }) => payload.postDeleted,
  })
  postDeleted() {
    return pubsub.asyncIterableIterator(POST_DELETED);
  }
}
