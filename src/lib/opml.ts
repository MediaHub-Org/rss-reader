/**
 * OPML (de-facto standard for feed subscriptions) import/export, plus a JSON
 * full-backup variant that also carries read status — OPML has nowhere to put it.
 *
 * Format detection is content-based: XML → OPML, `{` → JSON backup.
 */
import type { Article, Feed, Preferences } from '../types';
import { feedIdForUrl } from './feedParser';
import { isDesktopApp, saveTextFile } from './desktop';

export interface ExportFeed {
  /** Stable id, only present in full backups (used to remap cached articles). */
  id?: string;
  url: string;
  title: string;
  siteUrl?: string;
  /** Folder/group this feed belongs to (round-trips through OPML nesting). */
  folder?: string;
  description?: string;
  iconUrl?: string;
  addedAt?: number;
}

export interface ImportResult {
  feeds: ExportFeed[];
  readIds?: Record<string, true>;
  format: 'opml' | 'json';
  warnings: string[];
  /** Unique folder names found in the file, sorted A–Z. */
  folders: string[];
  /** Present for full backups (v2): cached articles keyed by feed id. */
  articles?: Record<string, Article[]>;
  /** Present for full backups (v2): portable preferences. */
  preferences?: Partial<Preferences>;
  /** True for a full backup that also carries articles/preferences. */
  full?: boolean;
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

/**
 * Everything needed to rebuild the reader on another device or origin:
 * subscriptions, folders, read state, preferences and the cached articles.
 * OPML cannot carry the last three, and the v1 JSON backup omits the cache.
 *
 * The YouTube API key is deliberately not included — a backup file is easy to
 * share by accident, and the key can be re-entered in Settings.
 */
export function exportFullBackup(
  feeds: Feed[],
  readIds: Record<string, true>,
  folders: string[],
  prefs: Preferences,
  articles: Record<string, Article[]>
): string {
  const folderNames = new Set<string>(folders.map((name) => name.trim()).filter(Boolean));
  for (const feed of feeds) {
    const folder = feed.folder?.trim();
    if (folder) folderNames.add(folder);
  }

  const { youtubeApiKey: _omitted, ...portablePrefs } = prefs;

  return JSON.stringify({
    app: 'rss-reader',
    version: 2,
    exportedAt: new Date().toISOString(),
    feeds: feeds.map((f) => ({
      id: f.id,
      url: f.url,
      title: f.title,
      siteUrl: f.siteUrl,
      folder: f.folder,
      description: f.description,
      iconUrl: f.iconUrl,
      addedAt: f.addedAt,
    })),
    folders: [...folderNames].sort(byName),
    readIds: Object.keys(readIds),
    preferences: portablePrefs,
    articles,
  });
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

const BACKUP_ARTICLE_LIMIT = 5_000;

/** Validate the portable subset of preferences in a full backup. */
function parseBackupPreferences(raw: any): Partial<Preferences> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Partial<Preferences> = {};

  const themes: Preferences['theme'][] = ['light', 'dark', 'system'];
  if (themes.includes(raw.theme)) out.theme = raw.theme;

  const densities: Preferences['density'][] = ['compact', 'comfortable'];
  if (densities.includes(raw.density)) out.density = raw.density;

  const sizes: Preferences['fontSize'][] = ['small', 'medium', 'large'];
  if (sizes.includes(raw.fontSize)) out.fontSize = raw.fontSize;

  for (const key of ['embedMedia', 'hideRead', 'sidebarCollapsed'] as const) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key];
  }

  const sorts: Preferences['sidebarSort'][] = [
    'name-asc',
    'name-desc',
    'modified-desc',
    'modified-asc',
    'created-desc',
    'created-asc',
  ];
  if (sorts.includes(raw.sidebarSort)) out.sidebarSort = raw.sidebarSort;

  if (Number.isFinite(raw.sidebarWidth)) {
    out.sidebarWidth = Math.min(480, Math.max(200, Math.round(raw.sidebarWidth)));
  }

  if (Array.isArray(raw.collapsedFolders)) {
    const names = raw.collapsedFolders
      .filter((name: unknown): name is string => typeof name === 'string')
      .map((name: string) => name.trim())
      .filter(Boolean);
    out.collapsedFolders = [...new Set<string>(names)];
  }

  // The API key is intentionally not round-tripped through backups.
  return Object.keys(out).length ? out : undefined;
}

/** Keep only the fields the reader understands, so imported JSON cannot inject junk. */
function cleanBackupArticle(raw: any, feedId: string, oldFeedId: string): Article | null {
  if (!raw || typeof raw !== 'object') return null;
  const originalId = typeof raw.id === 'string' ? raw.id : '';
  if (!originalId) return null;

  const id =
    oldFeedId !== feedId && originalId.startsWith(`${oldFeedId}-`)
      ? `${feedId}-${originalId.slice(oldFeedId.length + 1)}`
      : originalId;

  const publishedAt = Number(raw.publishedAt);
  return {
    id,
    feedId,
    title: typeof raw.title === 'string' ? raw.title : '(untitled)',
    link: typeof raw.link === 'string' ? raw.link : undefined,
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    contentHtml: typeof raw.contentHtml === 'string' ? raw.contentHtml : '',
    author: typeof raw.author === 'string' ? raw.author : undefined,
    publishedAt: Number.isFinite(publishedAt) ? publishedAt : Date.now(),
    thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail : undefined,
    youtubeId: typeof raw.youtubeId === 'string' ? raw.youtubeId : undefined,
    audioUrl: typeof raw.audioUrl === 'string' ? raw.audioUrl : undefined,
    audioType: typeof raw.audioType === 'string' ? raw.audioType : undefined,
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
  /** Backup feed id → id this device will use (URLs are hashed into ids). */
  const idMap = new Map<string, string>();

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
    // Full backups carry the id so a restored feed keeps the same id even when
    // its stored URL was changed by redirect/discovery (see trackAlternate).
    const rawId = typeof entry?.id === 'string' ? entry.id : '';
    const id = /^f[a-z0-9]+$/i.test(rawId) ? rawId : feedIdForUrl(url);
    if (rawId) idMap.set(rawId, id);
    feeds.push({
      id,
      url,
      title: String(entry?.title ?? '').trim(),
      siteUrl: entry?.siteUrl || undefined,
      folder,
      description: typeof entry?.description === 'string' ? entry.description : undefined,
      iconUrl: typeof entry?.iconUrl === 'string' ? entry.iconUrl : undefined,
      addedAt: Number.isFinite(entry?.addedAt) ? entry.addedAt : undefined,
    });
  }

  const feedIds = new Set(feeds.map((feed) => feed.id ?? feedIdForUrl(feed.url)));
  const articles: Record<string, Article[]> = {};
  const articleIdMap = new Map<string, string>();
  let skippedArticles = 0;

  if (data?.version === 2 && data?.articles && typeof data.articles === 'object') {
    for (const [backupFeedId, list] of Object.entries<any[]>(data.articles)) {
      const feedId = idMap.get(backupFeedId) ?? backupFeedId;
      const rawList = Array.isArray(list) ? list : [];
      if (!feedIds.has(feedId)) {
        skippedArticles += rawList.length;
        continue;
      }
      const cleaned: Article[] = [];
      for (const item of rawList.slice(0, BACKUP_ARTICLE_LIMIT)) {
        const article = cleanBackupArticle(item, feedId, backupFeedId);
        if (!article) continue;
        cleaned.push(article);
        if (typeof item?.id === 'string' && item.id !== article.id) {
          articleIdMap.set(item.id, article.id);
        }
      }
      if (cleaned.length) {
        cleaned.sort((a, b) => b.publishedAt - a.publishedAt);
        articles[feedId] = cleaned;
      }
    }
  }
  if (skippedArticles) {
    warnings.push(
      `${skippedArticles} cached article${skippedArticles === 1 ? '' : 's'} skipped because the feed is not in this backup.`
    );
  }

  const readIds: Record<string, true> = {};
  if (Array.isArray(data?.readIds)) {
    for (const id of data.readIds) {
      if (typeof id !== 'string') continue;
      let mapped = articleIdMap.get(id);
      if (!mapped) {
        for (const [oldId, newId] of idMap) {
          if (oldId !== newId && id.startsWith(`${oldId}-`)) {
            mapped = `${newId}${id.slice(oldId.length)}`;
            break;
          }
        }
      }
      readIds[mapped ?? id] = true;
    }
  }

  if (!feeds.length && !folderNames.size) {
    throw new ImportError('No valid feed URLs or folders were found in that backup.');
  }

  const full = data?.version === 2;
  return {
    feeds: sortImportedFeeds(feeds),
    readIds,
    format: 'json',
    warnings,
    folders: [...folderNames].sort(byName),
    ...(full
      ? {
          articles,
          preferences: parseBackupPreferences(data?.preferences),
          full: true,
        }
      : {}),
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

/**
 * Export a text file. In the browser this triggers a download; in the desktop
 * shell it opens the native Save dialog. Returns false when the user cancels a
 * native save.
 */
export async function downloadFile(
  filename: string,
  contents: string,
  mime: string
): Promise<boolean> {
  if (isDesktopApp()) return saveTextFile(filename, contents);

  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return true;
}
