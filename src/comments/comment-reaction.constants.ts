export const COMMENT_REACTION_EMOJIS = [
  '👍',
  '❤️',
  '😂',
  '😮',
  '😢',
  '🔥',
] as const;

export type CommentReactionEmoji = (typeof COMMENT_REACTION_EMOJIS)[number];

export function isCommentReactionEmoji(
  value: string,
): value is CommentReactionEmoji {
  return (COMMENT_REACTION_EMOJIS as readonly string[]).includes(value);
}
