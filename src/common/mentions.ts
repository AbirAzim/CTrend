/**
 * Extracts @mention usernames from free text (comments, captions, chat
 * messages). Usernames are always lowercase alphanumeric + underscore
 * (see `slugifyUsername` in users.service.ts), so the pattern is a safe
 * superset of that.
 */
const MENTION_RE = /@([a-zA-Z0-9_]{2,30})/g;

/** De-duplicated, lowercased usernames mentioned in `text`. */
export function parseMentionUsernames(
  text: string | null | undefined,
): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  for (const match of text.matchAll(MENTION_RE)) {
    seen.add(match[1].toLowerCase());
  }
  return [...seen];
}

/** Usernames present in `nextText` but not in `prevText` — used so editing a
 * comment/caption only notifies newly-added mentions, not ones already there. */
export function newlyMentionedUsernames(
  prevText: string | null | undefined,
  nextText: string | null | undefined,
): string[] {
  const prev = new Set(parseMentionUsernames(prevText));
  return parseMentionUsernames(nextText).filter((u) => !prev.has(u));
}
