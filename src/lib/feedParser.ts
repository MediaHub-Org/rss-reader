import Parser from 'rss-parser';
import { articleId, hash } from './hash';
import { resolveUrl } from './url';
import { extractYouTubeId, extractYouTubeIdFromHtml, thumbnailUrl } from './youtube';
import type { Article, Feed } from '../types';

export class FeedParseError extends Error {}

const parser = new Parser({
  timeout: 15_000,
  maxRedirects: 5,
  headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ['media:group', 'mediaGroup'],
      ['dc:creator', 'dcCreator'],
      ['published', 'published'],
      ['updated', 'updated'],
    ],
    feed: ['icon', 'logo'],
  },
});

type RawItem = Record<string, any>;
type RawFeed = Record<string, any>;

/** Strip markup down to readable plain text. */
export function toPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip markup down to a readable plain-text excerpt. */
export function toExcerpt(html: string, limit = 240): string {
  const text = toPlainText(html);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export function pickDate(...candidates: unknown[]): number {
  for (const value of candidates) {
    if (!value) continue;
    if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
    const parsed = Date.parse(String(value));
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function pickString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && typeof (value as any)._ === 'string') {
    const inner = (value as any)._.trim();
    if (inner) return inner;
  }
  if (value && typeof value === 'object' && typeof (value as any)['#'] === 'string') {
    const inner = (value as any)['#'].trim();
    if (inner) return inner;
  }
  return undefined;
}

/** Pull a usable image out of an enclosure/media element or the HTML itself. */
function extractImage(item: RawItem, base?: string): string | undefined {
  const enclosure = item.enclosure;
  if (enclosure?.url && /^https?:/i.test(enclosure.type || enclosure.url || '')) {
    if (/\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(enclosure.url) || /^image\//i.test(enclosure.type || '')) {
      const resolved = resolveUrl(base, enclosure.url);
      if (resolved) return resolved;
    }
  }
  for (const group of [item.mediaContent, item.mediaThumbnail]) {
    const list = Array.isArray(group) ? group : group ? [group] : [];
    for (const entry of list) {
      const url = entry?.['$']?.url || entry?.url;
      if (url && /^(https?:)?\/\//i.test(url)) {
        const resolved = resolveUrl(base, String(url));
        if (resolved) return resolved;
      }
    }
  }
  const html = pickString(item.contentEncoded) || pickString(item.content) || pickString(item.summary) || '';
  const match = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html);
  if (match) {
    const resolved = resolveUrl(base, match[1]);
    if (resolved && !/^data:/i.test(resolved)) return resolved;
  }
  return undefined;
}

/**
 * Pull a playable audio URL out of an enclosure -- podcast episode audio.
 * Every podcast host (Spotify for Podcasters/Anchor, Libsyn, SoundCloud,
 * Transistor, ...) publishes the episode file the same standard way, as an
 * <enclosure> with an audio/* type, so this covers all of them at once
 * rather than needing per-platform handling.
 */
function extractAudio(item: RawItem, base?: string): { url: string; type?: string } | undefined {
  const enclosure = item.enclosure;
  if (!enclosure?.url) return undefined;
  const type = pickString(enclosure.type) ?? '';
  const looksLikeAudio =
    /^audio\//i.test(type) || /\.(mp3|m4a|aac|ogg|oga|wav|flac|opus)(\?|$)/i.test(enclosure.url);
  if (!looksLikeAudio) return undefined;
  const resolved = resolveUrl(base, enclosure.url);
  return resolved ? { url: resolved, type: type || undefined } : undefined;
}

function normalizeItem(feedId: string, base: string | undefined, item: RawItem): Article | null {
  const title = pickString(item.title) || '(untitled)';
  const link = resolveUrl(base, pickString(item.link)) ?? undefined;
  const guid = pickString(item.guid) ?? pickString(item.id);

  const rawMediaDesc = item.mediaGroup?.['media:description'];
  const mediaDesc = pickString(Array.isArray(rawMediaDesc) ? rawMediaDesc[0] : rawMediaDesc);
  const mediaDescHtml = mediaDesc
    ? `<p>${mediaDesc
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n{2,}/g, '</p><p>')
        .replace(/\n/g, '<br>')}</p>`
    : '';

  const html =
    pickString(item.contentEncoded) ||
    pickString(item.content) ||
    pickString(item['content:encoded']) ||
    pickString(item.summary) ||
    pickString(item.description) ||
    pickString(item.contentSnippet) ||
    mediaDescHtml ||
    '';

  const publishedAt = pickDate(
    item.isoDate,
    item.pubDate,
    item.published,
    item.updated,
    item.date,
    item['dc:date']
  );

  const image = extractImage(item, base);
  const audio = extractAudio(item, base);
  const youtubeId =
    extractYouTubeId(link) ??
    extractYouTubeIdFromHtml(html) ??
    extractYouTubeId(title) ??
    undefined;

  const decoratedHtml =
    image && !youtubeId && !html.includes(image)
      ? `${html}<figure class="feed-image"><img src="${image}" alt="" loading="lazy"></figure>`
      : html;

  const author =
    pickString(item.author) ?? pickString(item['dcCreator']) ?? pickString(item.creator);
  const searchText = `${title}\n${toPlainText(decoratedHtml)}\n${author ?? ''}`
    .slice(0, 60_000)
    .toLowerCase();

  return {
    id: articleId(feedId, { guid, link, title, publishedAt, youtubeId }),
    feedId,
    title,
    link,
    summary: toExcerpt(decoratedHtml || title),
    contentHtml: decoratedHtml,
    searchText,
    author,
    publishedAt,
    thumbnail: image ?? (youtubeId ? thumbnailUrl(youtubeId) : undefined),
    youtubeId,
    audioUrl: audio?.url,
    audioType: audio?.type,
  };
}

export interface ParseResult {
  feed: Omit<Feed, 'id' | 'addedAt'>;
  articles: Article[];
}

/**
 * Parse an RSS/Atom document into normalized app types.
 * Throws FeedParseError with a human-readable message on malformed input.
 */
export async function parseFeedXml(xml: string, feedId: string): Promise<ParseResult> {
  let raw: RawFeed;
  try {
    raw = (await parser.parseString(xml)) as unknown as RawFeed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new FeedParseError(
      /valid|XML|parse|Unclosed|root tag/i.test(message)
        ? 'That URL returned something that is not a valid RSS/Atom feed.'
        : `Could not parse the feed: ${message}`
    );
  }
  return normalize(raw, feedId);
}

function normalize(raw: RawFeed, feedId: string): ParseResult {
  const siteUrl =
    resolveUrl(undefined, pickString(raw.link)) ||
    resolveUrl(undefined, pickString(raw.website)) ||
    resolveUrl(undefined, typeof raw.links?.[0] === 'string' ? raw.links[0] : undefined) ||
    undefined;

  const feed: Omit<Feed, 'id' | 'addedAt'> = {
    url: resolveUrl(undefined, pickString(raw.feedUrl)) || resolveUrl(undefined, siteUrl) || '',
    title: pickString(raw.title) || 'Untitled feed',
    siteUrl,
    description: pickString(raw.description),
    iconUrl:
      resolveUrl(siteUrl, pickString(raw.icon)) ??
      resolveUrl(siteUrl, pickString(raw.logo)) ??
      extractImage(raw as RawItem, siteUrl) ??
      undefined,
  };

  const items: RawItem[] = Array.isArray(raw.items) ? raw.items : [];
  const articles = items
    .map((item) => normalizeItem(feedId, siteUrl, item))
    .filter((a): a is Article => a !== null)
    // De-duplicate within a single document (some feeds repeat entries).
    .filter((a, index, all) => all.findIndex((b) => b.id === a.id) === index)
    .sort((a, b) => b.publishedAt - a.publishedAt);

  if (!articles.length && !feed.title) {
    throw new FeedParseError('The feed contains no readable entries.');
  }

  return { feed, articles };
}

/** Guess whether a text blob looks like a feed before spending a parse on it. */
export function looksLikeFeed(text: string): boolean {
  const head = text.slice(0, 4096);
  if (!head.trim()) return false;
  if (/<rss[\s>]/i.test(head)) return true;
  if (/<feed[\s>]/i.test(head) && /xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom/.test(head)) return true;
  if (/<rdf[\s>]/i.test(head)) return true;
  if (/<\?xml/i.test(head) && /<(rss|feed|channel|entry)/i.test(text.slice(0, 20000))) return true;
  return false;
}

/** Stable id for a subscribed URL, so re-adding a feed reuses the same record. */
export function feedIdForUrl(url: string): string {
  return `f${hash(url.replace(/\/+$/, '').toLowerCase())}`;
}
