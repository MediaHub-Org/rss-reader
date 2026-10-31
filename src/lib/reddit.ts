import type { Article, Feed } from '../types';
import { articleId } from './hash';
import { toExcerpt, toPlainText, type ParseResult } from './feedParser';
import { cleanTitle } from './format';

/**
 * Reddit RSS is being retired (November 2026) and the public API follows in
 * 2027. For subscribed `reddit.com/r/<sub>` feeds, read the public Arctic Shift
 * archive instead and normalize its JSON into the same shape as an RSS feed.
 *
 * This module is deliberately dependency-free and only runs when a Reddit URL
 * is subscribed. If the archive is unavailable, fetchFeed falls back to the
 * original Reddit RSS URL until Reddit switches it off.
 */
const ARCHIVE_ENDPOINT = 'https://arctic-shift.photon-reddit.com/api/posts/search';

interface RedditImage {
  source?: { url?: string };
}

export interface RedditPost {
  id?: string;
  title?: string;
  selftext?: string;
  selftext_html?: string;
  url?: string;
  url_overridden_by_dest?: string;
  permalink?: string;
  author?: string;
  created_utc?: number;
  thumbnail?: string;
  preview?: { images?: RedditImage[] };
}

interface RedditResponse {
  data?: RedditPost[];
}

/** Extract the subreddit from a Reddit feed/profile URL, including `.rss`. */
export function subredditFromUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'reddit.com' && host !== 'old.reddit.com') return null;
  const match = /^\/r\/([A-Za-z0-9_]+)(?:\/|$)/.exec(url.pathname);
  return match?.[1] ?? null;
}

function decodeEntities(value: string): string {
  if (typeof document !== 'undefined') {
    const doc = new DOMParser().parseFromString(value, 'text/html');
    return doc.documentElement.textContent ?? value;
  }
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function postHtml(post: RedditPost): string {
  if (post.selftext_html) return decodeEntities(post.selftext_html);
  if (post.selftext) {
    return post.selftext
      .split(/\n{2,}/)
      .map((paragraph) => `<p>${paragraph.replace(/[<>&]/g, (char) => `&#${char.charCodeAt(0)};`)}</p>`)
      .join('');
  }
  return '';
}

function postLink(post: RedditPost): string | undefined {
  const permalink = post.permalink ? `https://www.reddit.com${post.permalink}` : undefined;
  const external = post.url_overridden_by_dest || post.url;
  if (external && !/^https?:\/\/(?:www\.)?reddit\.com\//i.test(external)) return external;
  return permalink;
}

function postThumbnail(post: RedditPost): string | undefined {
  const image = post.preview?.images?.[0]?.source?.url;
  if (image) return decodeEntities(image);
  if (post.thumbnail?.startsWith('http')) return decodeEntities(post.thumbnail);
  return undefined;
}

/** Normalize an Arctic Shift response into the app's ParseResult. */
export function mapRedditPosts(subreddit: string, posts: RedditPost[], feedId: string): ParseResult {
  const siteUrl = `https://www.reddit.com/r/${subreddit}`;
  const articles: Article[] = posts
    .filter((post) => post.id && post.title)
    .map((post) => {
      const html = postHtml(post);
      const link = postLink(post);
      const publishedAt = Math.max(0, Math.floor((post.created_utc ?? 0) * 1000));
      return {
        id: articleId(feedId, {
          guid: `reddit-${post.id}`,
          link,
          title: cleanTitle(post.title!),
          publishedAt,
        }),
        feedId,
        title: cleanTitle(post.title!),
        link,
        summary: toExcerpt(html || cleanTitle(post.title!)),
        contentHtml: html,
        searchText: `${cleanTitle(post.title!)}\n${toPlainText(html)}\n${post.author ?? ''}`.toLowerCase(),
        author: post.author,
        publishedAt,
        thumbnail: postThumbnail(post),
      };
    })
    .sort((a, b) => b.publishedAt - a.publishedAt);

  const feed: Omit<Feed, 'id' | 'addedAt'> = {
    url: siteUrl,
    title: `r/${subreddit}`,
    siteUrl,
    description: 'Reddit posts via the Arctic Shift archive',
  };

  return { feed, articles };
}

export async function fetchRedditSubreddit(
  subreddit: string,
  feedId: string
): Promise<ParseResult> {
  const url =
    `${ARCHIVE_ENDPOINT}?subreddit=${encodeURIComponent(subreddit)}` +
    '&limit=50&sort=desc';
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Reddit archive returned ${response.status}`);
  const body = (await response.json()) as RedditResponse;
  return mapRedditPosts(subreddit, body.data ?? [], feedId);
}
