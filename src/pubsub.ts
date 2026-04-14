import { PubSub } from 'graphql-subscriptions';

export const VOTE_UPDATED = 'VOTE_UPDATED';
export const NEW_POST = 'NEW_POST';
export const POST_VOTE_UPDATED = 'POST_VOTE_UPDATED';

export const pubsub = new PubSub();
