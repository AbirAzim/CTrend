import { PubSub } from 'graphql-subscriptions';

export const VOTE_UPDATED = 'VOTE_UPDATED';
export const NEW_POST = 'NEW_POST';
export const POST_DELETED = 'POST_DELETED';
export const POST_VOTE_UPDATED = 'POST_VOTE_UPDATED';
export const POST_UPDATED = 'POST_UPDATED';
export const NEW_MESSAGE = 'NEW_MESSAGE';
export const ADMIN_MODERATOR_USER_MESSAGE = 'ADMIN_MODERATOR_USER_MESSAGE';
export const MESSAGE_READ = 'MESSAGE_READ';
export const MESSAGE_REACTION_CHANGED = 'MESSAGE_REACTION_CHANGED';
export const MESSAGE_DELETED = 'MESSAGE_DELETED';
export const TYPING_INDICATOR = 'TYPING_INDICATOR';
export const USER_PRESENCE_CHANGED = 'USER_PRESENCE_CHANGED';
export const NEW_NOTIFICATION = 'NEW_NOTIFICATION';
export const MATCH_PREDICTION_UPDATED = 'MATCH_PREDICTION_UPDATED';

export const pubsub = new PubSub();
// Each active GraphQL subscription adds an EventEmitter listener.
// Setting 0 removes the cap entirely (safe for a single-process pubsub).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(pubsub as any).ee?.setMaxListeners(0);

// Guard against transient socket write failures from stale websocket clients.
const rawPublish: (triggerName: string, payload: unknown) => Promise<void> =
  pubsub.publish.bind(pubsub);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(pubsub as any).publish = async (...args: any[]) => {
  try {
    return await rawPublish(args[0], args[1]);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'EPIPE' || code === 'ECONNRESET') {
      // Keep app flows alive even when a websocket client disconnects abruptly.
      console.warn('[PubSub] Ignored transient websocket publish error:', code);
      return;
    }
    throw err;
  }
};
