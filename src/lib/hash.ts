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
 * (guid → link → title+date), so read status survives feed refreshes.
 */
export function articleId(feedId: string, parts: {
  guid?: string;
  link?: string;
  title: string;
  publishedAt: number;
}): string {
  const key = parts.guid || parts.link || `${parts.title}#${parts.publishedAt}`;
  return `${feedId}-${hash(key)}`;
}
