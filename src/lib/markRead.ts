import type { Article } from '../types';

const DAY = 24 * 60 * 60 * 1000;

/** Article ids in `articles` that are unread and older than `days` (0 = all). */
export function articlesToMarkRead(
  articles: Article[],
  readIds: Record<string, true>,
  days: number,
  now = Date.now()
): string[] {
  const cutoff = days > 0 ? now - days * DAY : null;
  return articles
    .filter((article) => !readIds[article.id] && (!cutoff || article.publishedAt < cutoff))
    .map((article) => article.id);
}
