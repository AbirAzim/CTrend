/** Virtual sender id returned to clients — not a real User document. */
export const MODERATOR_SENDER_GQL_ID = 'moderator';

/** Sentinel ObjectId stored on moderator messages (no User row required). */
export const MODERATOR_SENDER_OBJECT_ID = '000000000000000000000001';

export const MODERATOR_DISPLAY_NAME = 'Ke Jitbe Moderator';

/** Relative path; clients resolve against their origin. */
export const MODERATOR_AVATAR_URL = '/logo.png';

/** Key in conversation.unreadCounts for admin-side unread on user replies. */
export const MODERATOR_ADMIN_UNREAD_KEY = '__admin__';
