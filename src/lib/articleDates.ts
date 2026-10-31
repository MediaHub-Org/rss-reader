import type { Article } from '../types';

/**
 * Feeds occasionally publish future dates (scheduled drafts, timezone bugs).
 * Normalize cached items too, not just freshly parsed ones, so they cannot pin
 * themselves to the top of the list forever.
 */
export function clampFutureDates(articles: Article[], now = Date.now()): Article[] {
  let changed = false;
  const next = articles.map((article) => {
    if (article.publishedAt <= now) return article;
    changed = true;
    return { ...article, publishedAt: now };
  });
  return changed ? next : articles;
}
