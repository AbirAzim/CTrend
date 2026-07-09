/** Same set as `COMMENT_REACTION_EMOJIS`, for visual consistency between post and comment reactions. */
export const POST_REACTION_EMOJIS = [
  '👍',
  '❤️',
  '😂',
  '😮',
  '😢',
  '🔥',
] as const;

export type PostReactionEmoji = (typeof POST_REACTION_EMOJIS)[number];

export function isPostReactionEmoji(value: string): value is PostReactionEmoji {
  return (POST_REACTION_EMOJIS as readonly string[]).includes(value);
}
