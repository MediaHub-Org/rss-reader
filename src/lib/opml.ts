/**
 * OPML (de-facto standard for feed subscriptions) import/export, plus a JSON
 * full-backup variant that also carries read status — OPML has nowhere to put it.
 *
 * Format detection is content-based: XML → OPML, `{` → JSON backup.
 */
import type { Feed } from '../types';

export interface ExportFeed {
  url: string;
  title: string;
  siteUrl?: string;
}

export interface ImportResult {
  feeds: ExportFeed[];
  readIds?: Record<string, true>;
  format: 'opml' | 'json';
  warnings: string[];
}

export class ImportError extends Error {}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  let candidate = value;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) candidate = `https://${candidate}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Serialize subscriptions to OPML 2.0. */
export function exportOpml(feeds: Feed[]): string {
  const now = new Date().toUTCString();
  const outlines = feeds
    .map(
      (feed) =>
        `    <outline type="rss" text="${escapeXml(feed.title)}" title="${escapeXml(
          feed.title
        )}" xmlUrl="${escapeXml(feed.url)}"${
          feed.siteUrl ? ` htmlUrl="${escapeXml(feed.siteUrl)}"` : ''
        } />`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>RSS Reader subscriptions</title>
    <dateCreated>${escapeXml(now)}</dateCreated>
  </head>
  <body>
${outlines}
  </body>
</opml>
`;
}

/** Full backup including read state. */
export function exportJson(feeds: Feed[], readIds: Record<string, true>): string {
  return JSON.stringify(
    {
      app: 'rss-reader',
      version: 1,
      exportedAt: new Date().toISOString(),
      feeds: feeds.map((f) => ({ url: f.url, title: f.title, siteUrl: f.siteUrl, addedAt: f.addedAt })),
      readIds: Object.keys(readIds),
    },
    null,
    2
  );
}

function parseOpml(text: string): ImportResult {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new ImportError('That file is not valid XML/OPML.');
  }
  const root = doc.documentElement;
  if (!root || root.localName.toLowerCase() !== 'opml') {
    throw new ImportError('That XML file is not an OPML document.');
  }

  const warnings: string[] = [];
  const feeds: ExportFeed[] = [];
  const seen = new Set<string>();

  const outlines = Array.from(doc.querySelectorAll('outline'));
  if (!outlines.length) {
    throw new ImportError('The OPML file contains no subscriptions.');
  }

  for (const node of outlines) {
    const xmlUrl =
      node.getAttribute('xmlUrl') || node.getAttribute('xmlurl') || node.getAttribute('url');
    if (!xmlUrl) continue; // folder/group node — recurse is implicit in the query

    const url = normalizeUrl(xmlUrl);
    if (!url) {
      warnings.push(`Skipped an entry with an invalid URL: ${xmlUrl.slice(0, 80)}`);
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);

    feeds.push({
      url,
      title: (node.getAttribute('title') || node.getAttribute('text') || '').trim(),
      siteUrl: node.getAttribute('htmlUrl') || undefined,
    });
  }

  if (!feeds.length) {
    throw new ImportError('No valid feed URLs were found in that OPML file.');
  }
  return { feeds, format: 'opml', warnings };
}

function parseJsonBackup(text: string): ImportResult {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError('That file is not valid JSON.');
  }

  const warnings: string[] = [];
  const rawFeeds = Array.isArray(data?.feeds) ? data.feeds : null;
  if (!rawFeeds) {
    throw new ImportError('That JSON file is not an RSS Reader backup.');
  }

  const feeds: ExportFeed[] = [];
  const seen = new Set<string>();
  for (const entry of rawFeeds) {
    const url = normalizeUrl(String(entry?.url ?? ''));
    if (!url) {
      warnings.push(`Skipped an entry with an invalid URL: ${String(entry?.url).slice(0, 80)}`);
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    feeds.push({ url, title: String(entry?.title ?? '').trim(), siteUrl: entry?.siteUrl || undefined });
  }

  const readIds: Record<string, true> = {};
  if (Array.isArray(data?.readIds)) {
    for (const id of data.readIds) if (typeof id === 'string') readIds[id] = true;
  }

  if (!feeds.length) throw new ImportError('No valid feed URLs were found in that backup.');
  return { feeds, readIds, format: 'json', warnings };
}

/** Parse an uploaded OPML or JSON backup file. */
export function importSubscriptions(text: string): ImportResult {
  const trimmed = text.trim();
  if (!trimmed) throw new ImportError('That file is empty.');

  if (trimmed.startsWith('{')) return parseJsonBackup(trimmed);
  if (/^<\?xml|^<opml|<!doctype opml/i.test(trimmed)) return parseOpml(trimmed);

  throw new ImportError('Unsupported file — expected an OPML or JSON backup.');
}

/** Trigger a browser download without touching the DOM permanently. */
export function downloadFile(filename: string, contents: string, mime: string): void {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
