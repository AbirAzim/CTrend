import { Resolver, Subscription } from '@nestjs/graphql';
import { pubsub, NEW_POST } from '../pubsub';
import { NewPostGql } from './graphql/new-post.types';

@Resolver()
export class NewPostsResolver {
  @Subscription(() => NewPostGql, {
    resolve: (payload: { newPost: NewPostGql }) => payload.newPost,
  })
  newPosts() {
    return pubsub.asyncIterableIterator(NEW_POST);
  }
}
