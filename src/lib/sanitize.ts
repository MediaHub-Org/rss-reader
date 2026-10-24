import DOMPurify from 'dompurify';
import { resolveUrl } from './url';

/**
 * Feed HTML is untrusted third-party content — this is the XSS boundary.
 *
 * DOMPurify strips scripts/event handlers/foreign content by default; on top of
 * that we (a) resolve relative URLs against the article's base URL and
 * (b) force external links to open safely in a new tab.
 */

let baseHref: string | undefined;

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  const element = node as Element;
  if (!element.getAttribute) return;

  for (const attr of ['href', 'src', 'srcset', 'poster', 'cite', 'action']) {
    const value = element.getAttribute(attr);
    if (!value) continue;
    const resolved = resolveUrl(baseHref, value);
    if (resolved === null) {
      element.removeAttribute(attr);
      continue;
    }
    if (attr === 'srcset') {
      element.setAttribute(attr, value);
      continue;
    }
    element.setAttribute(attr, resolved);
  }

  // `srcset` candidates each need resolution.
  const srcset = element.getAttribute('srcset');
  if (srcset) {
    const fixed = srcset
      .split(',')
      .map((part) => {
        const [url, ...rest] = part.trim().split(/\s+/);
        const resolved = resolveUrl(baseHref, url);
        return resolved ? [resolved, ...rest].join(' ') : null;
      })
      .filter(Boolean)
      .join(', ');
    if (fixed) element.setAttribute('srcset', fixed);
    else element.removeAttribute('srcset');
  }

  if (element.tagName === 'A') {
    const href = element.getAttribute('href');
    if (href && /^(https?:)?\/\//i.test(href)) {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer');
    }
    if (href && href.startsWith('#')) element.removeAttribute('href');
  }

  // Lazy-loading images keeps long articles cheap to render.
  if (element.tagName === 'IMG') {
    element.setAttribute('loading', 'lazy');
    element.setAttribute('decoding', 'async');
    if (!element.getAttribute('alt')) element.setAttribute('alt', '');
  }
});

const ALLOWED_TAGS = [
  'a', 'abbr', 'article', 'aside', 'b', 'blockquote', 'br', 'caption', 'cite', 'code',
  'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em',
  'figcaption', 'figure', 'font', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'i', 'img', 'kbd', 'li', 'main', 'mark', 'ol', 'p', 'pre',
  'q', 'rp', 'rt', 'ruby', 's', 'samp', 'section', 'small', 'source', 'span',
  'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th',
  'thead', 'time', 'tr', 'u', 'ul', 'var', 'video', 'track',
];

const ALLOWED_ATTR = [
  'href', 'src', 'srcset', 'sizes', 'alt', 'title', 'width', 'height', 'loading',
  'decoding', 'datetime', 'colspan', 'rowspan', 'span', 'start', 'type', 'value',
  'style', 'class', 'id', 'dir', 'lang', 'align', 'controls', 'poster', 'preload',
  'media', 'cite', 'target', 'rel', 'aria-label', 'aria-hidden', 'role',
];

/**
 * Sanitize a feed-provided HTML fragment for rendering.
 * @param html raw HTML from the feed
 * @param base absolute URL used to resolve relative links/images
 */
export function sanitizeHtml(html: string, base?: string): string {
  if (!html) return '';
  baseHref = base;
  try {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'noscript', 'template'],
      FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover'],
      RETURN_TRUSTED_TYPE: false,
    }) as unknown as string;
  } finally {
    baseHref = undefined;
  }
}

/** Plain-text excerpt safe for list rows (no HTML interpretation at all). */
export function sanitizeText(value: string): string {
  return DOMPurify.sanitize(value, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }) as unknown as string;
}
