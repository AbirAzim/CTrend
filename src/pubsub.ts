import { PubSub } from 'graphql-subscriptions';

export const VOTE_UPDATED = 'VOTE_UPDATED';
export const NEW_POST = 'NEW_POST';
export const POST_VOTE_UPDATED = 'POST_VOTE_UPDATED';
export const NEW_MESSAGE = 'NEW_MESSAGE';
export const MESSAGE_READ = 'MESSAGE_READ';
export const TYPING_INDICATOR = 'TYPING_INDICATOR';
export const USER_PRESENCE_CHANGED = 'USER_PRESENCE_CHANGED';
export const NEW_NOTIFICATION = 'NEW_NOTIFICATION';

export const pubsub = new PubSub();
// Each active GraphQL subscription adds an EventEmitter listener.
// Setting 0 removes the cap entirely (safe for a single-process pubsub).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(pubsub as any).ee?.setMaxListeners(0);
