/** URL helpers: relative resolution and normalization for feed content. */

/**
 * Resolve possibly-relative URLs in feed HTML against the feed/article base URL.
 * Feed authors routinely ship `src="/img/x.jpg"` and `href="../page"`.
 */
export function resolveUrl(base: string | undefined, value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(data:|mailto:|tel:|javascript:|about:)/i.test(trimmed)) {
    return /^javascript:/i.test(trimmed) ? null : trimmed;
  }
  if (!base) return trimmed;
  try {
    return new URL(trimmed, base).toString();
  } catch {
    return trimmed;
  }
}

/** True when the string is an absolute http(s) URL. */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

import { t } from './i18n';

export type UrlValidation = { ok: true; url: string } | { ok: false; error: string };

/**
 * Validate and canonicalise a URL the user typed into the "Add feed" field.
 * Bare domains (`example.com/feed.xml`) are promoted to HTTPS.
 */
export function normalizeFeedUrl(raw: string): UrlValidation {
  const value = raw.trim();
  if (!value) return { ok: false, error: t('Enter a feed URL to subscribe.') };

  let candidate = value;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) candidate = `https://${candidate}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: t('That does not look like a valid URL.') };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: t('Feed URLs must start with http:// or https://.') };
  }
  if (!url.hostname || url.hostname === '0.0.0.0') {
    return { ok: false, error: t('That host name is not valid.') };
  }
  if (/\s/.test(value)) return { ok: false, error: t('URLs cannot contain spaces.') };

  return { ok: true, url: url.toString() };
}

/** Derive a display origin ("example.com") from a URL, for icons/fallbacks. */
export function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Favicon URL for a feed, using the site origin when known.
 * Returns null when we have nothing to build one from — callers render a
 * letter avatar instead, so the app stays fully usable offline.
 */
export function faviconUrl(feed: { siteUrl?: string; url: string }): string | null {
  const origin = originOf(feed.siteUrl) ?? originOf(feed.url);
  if (!origin) return null;
  try {
    return `${new URL(origin).origin}/favicon.ico`;
  } catch {
    return null;
  }
}
