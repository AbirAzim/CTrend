/**
 * Google auto-generates a tiny "colored circle + initial" placeholder photo
 * for accounts that never set a real profile picture, served from the same
 * kind of googleusercontent.com URL as a genuine uploaded photo — so URL
 * presence alone can't tell them apart. Real photos are consistently much
 * larger (5KB+ even at the same 96x96 size) than the flat-color placeholder
 * (confirmed under ~2KB in samples), so file size is the signal — checked
 * via a HEAD request so the image itself never needs downloading.
 */
const DEFAULT_AVATAR_MAX_BYTES = 3000;

/**
 * Returns true if the photo looks like a genuine photo, false if it looks
 * like Google's auto-generated placeholder, or null if it couldn't be
 * determined (network/format issue) — callers should leave any existing
 * flag unchanged when null, rather than guessing.
 */
export async function resolveGoogleProfilePhotoIsReal(
  url: string,
): Promise<boolean | null> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length'));
    if (!len) return null;
    return len > DEFAULT_AVATAR_MAX_BYTES;
  } catch {
    return null;
  }
}
