import { PubSub } from 'graphql-subscriptions';

export const VOTE_UPDATED = 'VOTE_UPDATED';
export const NEW_POST = 'NEW_POST';

export const pubsub = new PubSub();
