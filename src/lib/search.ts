import type { Article } from '../types';

export interface SearchOptions {
  caseSensitive?: boolean;
  fullText?: boolean;
  /** Interpret the needle as a regular expression. */
  regex?: boolean;
}

const lowerCache = new WeakMap<Article, string>();
const rawCache = new WeakMap<Article, string>();

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Original-case text for case-sensitive body searches. */
export function rawSearchableText(article: Article): string {
  const cached = rawCache.get(article);
  if (cached !== undefined) return cached;

  const text = [
    article.title,
    article.summary,
    article.author ?? '',
    stripHtml(article.contentHtml),
  ]
    .join('\n');
  rawCache.set(article, text);
  return text;
}

/** Plain lower-case text for search; derived lazily for pre-searchText cache. */
export function searchableText(article: Article): string {
  if (article.searchText) return article.searchText;

  const cached = lowerCache.get(article);
  if (cached !== undefined) return cached;

  const text = rawSearchableText(article).toLowerCase();
  lowerCache.set(article, text);
  return text;
}

export function articleMatches(
  article: Article,
  query: string,
  options: SearchOptions = {}
): boolean {
  const needle = query.trim();
  if (!needle) return true;

  const fullText = options.fullText !== false;
  const caseSensitive = Boolean(options.caseSensitive);
  const titleText = [article.title, article.summary, article.author ?? ''].join('\n');

  if (options.regex) {
    try {
      const pattern = new RegExp(needle, caseSensitive ? '' : 'i');
      return pattern.test(fullText ? rawSearchableText(article) : titleText);
    } catch {
      return false;
    }
  }

  if (!fullText) {
    return caseSensitive
      ? titleText.includes(needle)
      : titleText.toLowerCase().includes(needle.toLowerCase());
  }

  if (caseSensitive) return rawSearchableText(article).includes(needle);
  return searchableText(article).includes(needle.toLowerCase());
}
