/** Small stable string hashing for article identity. */

/** FNV-1a, 32-bit → 8 hex chars. Fast, dependency-free, collision-safe enough. */
export function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Stable article id derived from the feed plus the item's own identity
 * (youtubeId -> guid -> link -> title+date), so read status survives feed
 * refreshes.
 *
 * youtubeId outranks guid on purpose: a YouTube channel feed can be read
 * either as plain RSS (guid is the Atom <id>, e.g. "yt:video:XXXXX") or,
 * when a Data API key is set, through the API (youtubeApi.ts keys off the
 * raw 11-char video id instead). Those two are different strings for the
 * same video, so without this a feed that ever switches between the two
 * paths -- key added, key starts failing, etc. -- would produce two
 * different ids for one video and show it twice. The video id is the one
 * thing both paths agree on.
 */
export function articleId(feedId: string, parts: {
  guid?: string;
  link?: string;
  title: string;
  publishedAt: number;
  youtubeId?: string;
}): string {
  const key = parts.youtubeId || parts.guid || parts.link || `${parts.title}#${parts.publishedAt}`;
  return `${feedId}-${hash(key)}`;
}
