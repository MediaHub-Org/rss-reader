/**
 * Feed retrieval with a layered CORS strategy, as decided:
 *
 *   1. direct browser fetch (works for CORS-enabled origins)
 *   2. local proxy   — /proxy on the dev server, or PROXY_URL env
 *   3. public proxy  — third-party fallback, used last because it depends on
 *                      someone else's uptime
 *
 * Every hop is HTTPS-only and every failure is reported with a readable message
 * so the UI can explain *why* a feed is unavailable.
 */
import { looksLikeFeed, parseFeedXml, type ParseResult } from './feedParser';
import { extractYouTubeFeedTarget, fetchYouTubeChannelFeed } from './youtubeApi';
import { invokeDesktop, isDesktopApp } from './desktop';

export const PROXY_URL: string | undefined =
  (import.meta.env.VITE_PROXY_URL as string | undefined) || undefined;

const PUBLIC_PROXIES = [
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url: string) => `https://r.jina.ai/${url}`, // last resort: returns extracted text
];

export type Via = 'native' | 'direct' | 'local-proxy' | 'public-proxy';

export interface FetchFeedResult {
  body: string;
  via: Via;
  finalUrl: string;
  /** Homepage link discovered when the user pasted a site URL instead of a feed. */
  discoveredFeedUrl?: string;
}

interface NativeFeedResponse {
  body: string;
  finalUrl: string;
  status: number;
  contentType: string;
}

export class FeedFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'FeedFetchError';
  }
}

/** Fetch raw text, trying each strategy in turn. */
async function getText(url: string): Promise<{ text: string; via: Via; finalUrl: string }> {
  // Desktop: one native request, no CORS and no third-party proxy.
  if (isDesktopApp()) {
    try {
      const result = await invokeDesktop<NativeFeedResponse>('fetch_feed', { url });
      if (!result.body.trim()) {
        throw new FeedFetchError('The feed returned an empty response.', result.status);
      }
      return { text: result.body, via: 'native', finalUrl: result.finalUrl || url };
    } catch (err) {
      if (err instanceof FeedFetchError) throw err;
      const message = typeof err === 'string' ? err : String((err as Error)?.message ?? err);
      throw new FeedFetchError(`Could not fetch this feed (${message}).`);
    }
  }

  const attempts: Array<{ via: Via; target: string; init?: RequestInit }> = [
    { via: 'direct', target: url },
    { via: 'local-proxy', target: `${PROXY_URL || '/proxy'}?url=${encodeURIComponent(url)}` },
    ...PUBLIC_PROXIES.map((build) => ({ via: 'public-proxy' as Via, target: build(url) })),
  ];

  const errors: string[] = [];

  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.target, {
        method: 'GET',
        redirect: 'follow',
        headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
        signal: AbortSignal.timeout(20_000),
      });

      if (!response.ok) {
        const detail = await safeMessage(response);
        errors.push(`${attempt.via}: ${response.status}${detail ? ` — ${detail}` : ''}`);
        if (response.status === 404 || response.status === 410) {
          throw new FeedFetchError('That feed URL returned 404 Not Found.', response.status);
        }
        continue;
      }

      const text = await response.text();
      if (!text.trim()) {
        errors.push(`${attempt.via}: empty response`);
        continue;
      }
      return { text, via: attempt.via, finalUrl: response.url || url };
    } catch (err) {
      if (err instanceof FeedFetchError) throw err;
      const message =
        err instanceof DOMException && err.name === 'TimeoutError'
          ? 'request timed out'
          : err instanceof TypeError
            ? 'blocked by CORS or network'
            : String((err as Error)?.message || err);
      errors.push(`${attempt.via}: ${message}`);
    }
  }

  throw new FeedFetchError(
    `Could not fetch this feed (${errors[errors.length - 1] || 'no route succeeded'}).`,
    0
  );
}

async function safeMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    const match = /\berror\b[^<]{0,120}/i.exec(text);
    return match ? match[0].trim().slice(0, 120) : '';
  } catch {
    return '';
  }
}

/** Pull an alternate feed link out of an HTML homepage. */
function discoverFeedLink(html: string, baseUrl: string): string | undefined {
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || '';
    if (!/(rss|atom|xml)/i.test(type)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

export interface ResolvedFeed {
  xml: string;
  finalUrl: string;
  via: Via;
}

/**
 * Fetch a user-supplied URL and work out what it is.
 * Accepts a feed URL directly, or a homepage from which a feed is discovered.
 */
export async function fetchFeedDocument(input: string): Promise<ResolvedFeed> {
  const { text, via, finalUrl } = await getText(input);
  const looksLike = looksLikeFeed(text);

  if (looksLike) return { xml: text, finalUrl, via };

  if (/<html[\s>]/i.test(text.slice(0, 2048)) || /<!doctype html/i.test(text.slice(0, 200))) {
    const discovered = discoverFeedLink(text, finalUrl);
    if (discovered && discovered !== finalUrl) {
      const nested = await getText(discovered);
      if (looksLikeFeed(nested.text)) {
        return { xml: nested.text, finalUrl: nested.finalUrl, via: nested.via };
      }
    }
    throw new FeedFetchError(
      'That page is a website, not a feed — and no RSS/Atom link was found on it.'
    );
  }

  throw new FeedFetchError('The response is not valid RSS or Atom content.');
}

export interface FeedArticlesResult {
  parsed: ParseResult;
  finalUrl: string;
}

/**
 * Resolve a subscribed URL into parsed articles. Routes a YouTube channel
 * feed through the Data API when a key is configured (see youtubeApi.ts for
 * why); any other feed, or a Data API failure, uses the plain RSS/Atom path.
 */
export async function fetchFeedArticles(url: string, feedId: string, youtubeApiKey?: string): Promise<FeedArticlesResult> {
  const target = youtubeApiKey ? extractYouTubeFeedTarget(url) : null;
  if (target) {
    try {
      const parsed = await fetchYouTubeChannelFeed(target, feedId, youtubeApiKey!);
      return { parsed, finalUrl: url };
    } catch (err) {
      console.warn('YouTube Data API fetch failed, falling back to the RSS feed:', err);
    }
  }

  const { xml, finalUrl } = await fetchFeedDocument(url);
  const parsed = await parseFeedXml(xml, feedId);
  return { parsed, finalUrl };
}
