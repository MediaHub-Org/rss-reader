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
  /** Folder/group this feed belongs to (round-trips through OPML nesting). */
  folder?: string;
}

export interface ImportResult {
  feeds: ExportFeed[];
  readIds?: Record<string, true>;
  format: 'opml' | 'json';
  warnings: string[];
  /** Unique folder names found in the file, sorted A–Z. */
  folders: string[];
}

/** Case/diacritic-insensitive A–Z ordering used everywhere feeds are listed. */
export function byName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

/**
 * Foldered feeds first (folders A–Z, feeds inside A–Z), then any ungrouped
 * feeds A–Z — matches the sidebar and OPML export order.
 */
function sortImportedFeeds(feeds: ExportFeed[]): ExportFeed[] {
  return [...feeds].sort((a, b) => {
    const folderA = a.folder?.trim() ?? '';
    const folderB = b.folder?.trim() ?? '';
    if (Boolean(folderA) !== Boolean(folderB)) return folderA ? -1 : 1;
    const folderCmp = byName(folderA, folderB);
    if (folderCmp !== 0) return folderCmp;
    return byName(a.title || a.url, b.title || b.url);
  });
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

const feedOutline = (feed: ExportFeed, indent: string): string =>
  `${indent}<outline type="rss" text="${escapeXml(feed.title)}" title="${escapeXml(
    feed.title
  )}" xmlUrl="${escapeXml(feed.url)}"${
    feed.siteUrl ? ` htmlUrl="${escapeXml(feed.siteUrl)}"` : ''
  } />`;

/**
 * Serialize subscriptions to OPML 2.0.
 *
 * Feeds are grouped into nested folder outlines — folders A–Z, and the feeds
 * inside each folder A–Z — so the structure survives an export → import
 * round-trip (or a trip through another reader). `folders` carries explicitly
 * created folders with no feeds yet, which would otherwise disappear.
 */
export function exportOpml(feeds: Feed[], folders: string[] = []): string {
  const now = new Date().toUTCString();
  const byTitle = (a: Feed, b: Feed) => byName(a.title, b.title);

  const grouped = new Map<string, Feed[]>();
  const loose: Feed[] = [];
  for (const feed of feeds) {
    const folder = feed.folder?.trim();
    if (!folder) {
      loose.push(feed);
      continue;
    }
    grouped.set(folder, [...(grouped.get(folder) ?? []), feed]);
  }

  const folderNames = new Set<string>(folders.map((name) => name.trim()).filter(Boolean));
  for (const name of grouped.keys()) folderNames.add(name);

  const folderOutlines = [...folderNames].sort(byName).map((folder) => {
    const list = (grouped.get(folder) ?? []).slice().sort(byTitle);
    if (!list.length) {
      return `    <outline text="${escapeXml(folder)}" title="${escapeXml(folder)}" />`;
    }
    return (
      `    <outline text="${escapeXml(folder)}" title="${escapeXml(folder)}">\n` +
      list.map((feed) => feedOutline(feed, '      ')).join('\n') +
      `\n    </outline>`
    );
  });

  const looseOutlines = loose.sort(byTitle).map((feed) => feedOutline(feed, '    '));

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>RSS Reader subscriptions</title>
    <dateCreated>${escapeXml(now)}</dateCreated>
  </head>
  <body>
${[...folderOutlines, ...looseOutlines].join('\n')}
  </body>
</opml>
`;
}

/** Full backup including read state. */
export function exportJson(
  feeds: Feed[],
  readIds: Record<string, true>,
  folders: string[] = []
): string {
  const folderNames = new Set<string>(folders.map((name) => name.trim()).filter(Boolean));
  for (const feed of feeds) {
    const folder = feed.folder?.trim();
    if (folder) folderNames.add(folder);
  }

  return JSON.stringify(
    {
      app: 'rss-reader',
      version: 1,
      exportedAt: new Date().toISOString(),
      feeds: feeds.map((f) => ({
        url: f.url,
        title: f.title,
        siteUrl: f.siteUrl,
        folder: f.folder,
        addedAt: f.addedAt,
      })),
      // Empty folders have no feed to carry the name, so list them explicitly.
      folders: [...folderNames].sort(byName),
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
  const folderNames = new Set<string>();

  const outlines = Array.from(doc.querySelectorAll('outline'));
  if (!outlines.length) {
    throw new ImportError('The OPML file contains no subscriptions.');
  }

  /**
   * Walk the outline tree so folder nesting survives: a feed inside
   * <outline text="News"> inherits that folder, and deeper nesting is joined
   * with " / " (e.g. "News / Tech"). A node without xmlUrl is a folder;
   * folder-only subtrees are recorded too, so empty folders round-trip.
   */
  const walk = (node: Element, ancestors: string[]): number => {
    let count = 0;

    for (const child of Array.from(node.children)) {
      if (child.localName.toLowerCase() !== 'outline') continue;

      const xmlUrl =
        child.getAttribute('xmlUrl') || child.getAttribute('xmlurl') || child.getAttribute('url');

      if (xmlUrl) {
        const url = normalizeUrl(xmlUrl);
        if (!url) {
          warnings.push(`Skipped an entry with an invalid URL: ${xmlUrl.slice(0, 80)}`);
          continue;
        }
        if (seen.has(url)) continue;
        seen.add(url);

        const folder = ancestors.join(' / ').trim() || undefined;
        if (folder) folderNames.add(folder);
        feeds.push({
          url,
          title: (child.getAttribute('title') || child.getAttribute('text') || '').trim(),
          siteUrl: child.getAttribute('htmlUrl') || undefined,
          folder,
        });
        count++;
        continue;
      }

      // Folder/group node: recurse with its name on the ancestor stack.
      const name = (child.getAttribute('title') || child.getAttribute('text') || '').trim();
      const next = name ? [...ancestors, name] : ancestors;
      const childCount = walk(child, next);
      if (childCount === 0 && name) folderNames.add(next.join(' / '));
      count += childCount;
    }

    return count;
  };

  const body = doc.querySelector('body') ?? root;
  walk(body, []);

  if (!feeds.length && !folderNames.size) {
    throw new ImportError('No valid feed URLs or folders were found in that OPML file.');
  }
  return {
    feeds: sortImportedFeeds(feeds),
    format: 'opml',
    warnings,
    folders: [...folderNames].sort(byName),
  };
}

function parseJsonBackup(text: string): ImportResult {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError('That file is not valid JSON.');
  }

  const warnings: string[] = [];
  const hasFeeds = Array.isArray(data?.feeds);
  const hasFolders = Array.isArray(data?.folders);
  if (!hasFeeds && !hasFolders) {
    throw new ImportError('That JSON file is not an RSS Reader backup.');
  }
  const rawFeeds: any[] = hasFeeds ? data.feeds : [];

  const feeds: ExportFeed[] = [];
  const folderNames = new Set<string>();
  const seen = new Set<string>();

  // Explicit folder list first, so folders with no feeds survive.
  if (hasFolders) {
    for (const name of data.folders) {
      if (typeof name !== 'string') continue;
      const folder = name.trim();
      if (folder) folderNames.add(folder);
    }
  }

  for (const entry of rawFeeds) {
    const url = normalizeUrl(String(entry?.url ?? ''));
    if (!url) {
      warnings.push(`Skipped an entry with an invalid URL: ${String(entry?.url).slice(0, 80)}`);
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    const folder = typeof entry?.folder === 'string' ? entry.folder.trim() || undefined : undefined;
    if (folder) folderNames.add(folder);
    feeds.push({
      url,
      title: String(entry?.title ?? '').trim(),
      siteUrl: entry?.siteUrl || undefined,
      folder,
    });
  }

  const readIds: Record<string, true> = {};
  if (Array.isArray(data?.readIds)) {
    for (const id of data.readIds) if (typeof id === 'string') readIds[id] = true;
  }

  if (!feeds.length && !folderNames.size) {
    throw new ImportError('No valid feed URLs or folders were found in that backup.');
  }
  return {
    feeds: sortImportedFeeds(feeds),
    readIds,
    format: 'json',
    warnings,
    folders: [...folderNames].sort(byName),
  };
}

/** Parse an uploaded OPML or JSON backup file. */
export function importSubscriptions(text: string): ImportResult {
  const trimmed = text.trim();
  if (!trimmed) throw new ImportError('That file is empty.');

  if (trimmed.startsWith('{')) return parseJsonBackup(trimmed);
  if (trimmed.startsWith('<')) return parseOpml(trimmed);

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
