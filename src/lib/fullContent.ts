import { fetchRemoteText } from './fetchFeed';
import { sanitizeHtml } from './sanitize';

const CANDIDATES = [
  '[itemprop="articleBody"]',
  'article',
  'main',
  '[role="main"]',
  '.post-content',
  '.entry-content',
  '.article-content',
  '.article-body',
  '.story-body',
  '#article-body',
  '#content',
];

const STRIP = [
  'script',
  'style',
  'noscript',
  'nav',
  'aside',
  'footer',
  'header',
  'form',
  'button',
  'iframe',
  'object',
  'embed',
];

const BOILERPLATE = [
  '[class*="share"]',
  '[class*="social"]',
  '[class*="related"]',
  '[class*="comment"]',
  '[class*="newsletter"]',
  '[class*="advert"]',
  '[class*="promo"]',
  '[class*="cookie"]',
  '[id*="comment"]',
  '[id*="sidebar"]',
];

/** Rough visible-text length, used to pick the densest content container. */
function textLength(element: Element | null): number {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim().length;
}

/**
 * Turn a fetched article page into safe reader HTML.
 *
 * There is no readability dependency: pick the densest known content
 * container, strip chrome/boilerplate, then run everything through the same
 * DOMPurify boundary as feed HTML (including relative-URL resolution).
 */
export function extractReadableHtml(pageHtml: string, baseUrl: string): string {
  const doc = new DOMParser().parseFromString(pageHtml, 'text/html');
  for (const selector of STRIP) {
    doc.querySelectorAll(selector).forEach((node) => node.remove());
  }

  let best: Element | null = doc.body;
  let bestLength = textLength(best);
  for (const selector of CANDIDATES) {
    const candidate = doc.querySelector(selector);
    const length = textLength(candidate);
    if (candidate && length > bestLength) {
      best = candidate;
      bestLength = length;
    }
  }
  if (!best) return '';

  for (const selector of BOILERPLATE) {
    best.querySelectorAll(selector).forEach((node) => node.remove());
  }

  const html = best.innerHTML.trim();
  if (!html) return '';
  return sanitizeHtml(html, baseUrl);
}

/** Safe visible-text length of already-sanitised HTML. */
export function readableLength(html: string): number {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

const MAX_CACHED_ARTICLES = 24;
const cache = new Map<string, string>();

function readCache(url: string): string | undefined {
  const value = cache.get(url);
  if (value === undefined) return undefined;
  // Refresh LRU position.
  cache.delete(url);
  cache.set(url, value);
  return value;
}

function writeCache(url: string, html: string): void {
  cache.delete(url);
  cache.set(url, html);
  while (cache.size > MAX_CACHED_ARTICLES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function cachedFullContent(url: string): string | undefined {
  return readCache(url);
}

/** Fetch and extract the original article body; cached for the session. */
export async function fetchFullContent(url: string): Promise<string> {
  const hit = readCache(url);
  if (hit) return hit;

  let page: string;
  try {
    page = await fetchRemoteText(url, 'text/html, application/xhtml+xml, */*');
  } catch {
    throw new Error('Could not reach the original article page.');
  }
  const html = extractReadableHtml(page, url);
  if (readableLength(html) < 120) {
    throw new Error('Could not find readable article content on that page.');
  }
  writeCache(url, html);
  return html;
}
