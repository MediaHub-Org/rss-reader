/**
 * OPML 2.0 export/import. Subscriptions and folder nesting only; the JSON
 * backup adds read state, preferences and cached articles.
 */
import type { Feed } from '../../types';
import { t } from '../i18n';
import { cleanTitle } from '../format';
import {
  byName,
  collectFolderNames,
  ImportError,
  normalizeImportUrl,
  sortImportedFeeds,
  type ExportFeed,
  type ImportResult,
} from './types';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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

  const byTitle = (a: Feed, b: Feed) => byName(a.title, b.title);
  const folderOutlines = collectFolderNames(feeds, folders).map((folder) => {
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
  const dateCreated = escapeXml(new Date().toUTCString());

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>RSS Reader subscriptions</title>
    <dateCreated>${dateCreated}</dateCreated>
  </head>
  <body>
${[...folderOutlines, ...looseOutlines].join('\n')}
  </body>
</opml>
`;
}

export function parseOpml(text: string): ImportResult {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new ImportError(t('That file is not valid XML/OPML.'));
  }
  const root = doc.documentElement;
  if (!root || root.localName.toLowerCase() !== 'opml') {
    throw new ImportError(t('That XML file is not an OPML document.'));
  }

  const warnings: string[] = [];
  const feeds: ExportFeed[] = [];
  const seen = new Set<string>();
  const folderNames = new Set<string>();

  const outlines = Array.from(doc.querySelectorAll('outline'));
  if (!outlines.length) {
    throw new ImportError(t('The OPML file contains no subscriptions.'));
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
        const url = normalizeImportUrl(xmlUrl);
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
          title: cleanTitle(child.getAttribute('title') || child.getAttribute('text') || ''),
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
    throw new ImportError(t('No valid feed URLs or folders were found in that OPML file.'));
  }
  return {
    feeds: sortImportedFeeds(feeds),
    format: 'opml',
    warnings,
    folders: [...folderNames].sort(byName),
  };
}
