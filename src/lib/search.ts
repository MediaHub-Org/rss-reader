import type { Article } from '../types';

const fallbackText = new WeakMap<Article, string>();

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plain lower-case text for search; derived lazily for pre-searchText cache. */
export function searchableText(article: Article): string {
  if (article.searchText) return article.searchText;

  const cached = fallbackText.get(article);
  if (cached !== undefined) return cached;

  const text = [
    article.title,
    article.summary,
    article.author ?? '',
    stripHtml(article.contentHtml),
  ]
    .join('\n')
    .toLowerCase();
  fallbackText.set(article, text);
  return text;
}

export function articleMatches(article: Article, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return !needle || searchableText(article).includes(needle);
}
