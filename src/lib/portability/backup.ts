/**
 * JSON backup: v1 carried subscriptions/folders/read state, v2 adds portable
 * preferences and the cached articles from IndexedDB. Parsing is deliberately
 * defensive because the file is user-supplied.
 */
import type { Article, Feed, Preferences } from '../../types';
import { feedIdForUrl } from '../feedParser';
import { isFeedId } from '../feedId';
import {
  byName,
  collectFolderNames,
  ImportError,
  isOneOf,
  isRecord,
  normalizeImportUrl,
  sortImportedFeeds,
  stringValue,
  type ExportFeed,
  type ImportResult,
} from './types';

const BACKUP_ARTICLE_LIMIT = 5_000;

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
  const { youtubeApiKey: _omitted, prefsVersion: _version, ...portablePrefs } = prefs;

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
    folders: collectFolderNames(feeds, folders),
    readIds: Object.keys(readIds),
    preferences: portablePrefs,
    articles,
  });
}

/** Validate the portable subset of preferences in a full backup. */
function parseBackupPreferences(raw: unknown): Partial<Preferences> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Partial<Preferences> = {};

  if (isOneOf(raw.theme, ['light', 'dark', 'system'] as const)) out.theme = raw.theme;
  if (isOneOf(raw.density, ['compact', 'comfortable'] as const)) out.density = raw.density;
  if (isOneOf(raw.fontSize, ['small', 'medium', 'large'] as const)) out.fontSize = raw.fontSize;
  if (typeof raw.embedMedia === 'boolean') out.embedMedia = raw.embedMedia;
  if (typeof raw.hideRead === 'boolean') out.hideRead = raw.hideRead;
  if (typeof raw.sidebarCollapsed === 'boolean') out.sidebarCollapsed = raw.sidebarCollapsed;
  if (typeof raw.closeToTray === 'boolean') out.closeToTray = raw.closeToTray;
  if (typeof raw.notifyNewArticles === 'boolean') out.notifyNewArticles = raw.notifyNewArticles;
  if (typeof raw.startAtLogin === 'boolean') out.startAtLogin = raw.startAtLogin;

  if (
    isOneOf(raw.sidebarSort, [
      'name-asc',
      'name-desc',
      'modified-desc',
      'modified-asc',
      'created-desc',
      'created-asc',
    ] as const)
  ) {
    out.sidebarSort = raw.sidebarSort;
  }

  if (typeof raw.sidebarWidth === 'number' && Number.isFinite(raw.sidebarWidth)) {
    out.sidebarWidth = Math.min(480, Math.max(200, Math.round(raw.sidebarWidth)));
  }

  if (Array.isArray(raw.collapsedFolders)) {
    const names = raw.collapsedFolders
      .filter((name): name is string => typeof name === 'string')
      .map((name) => name.trim())
      .filter(Boolean);
    out.collapsedFolders = [...new Set<string>(names)];
  }

  if (Array.isArray(raw.mutedFeedIds)) {
    out.mutedFeedIds = [
      ...new Set(
        raw.mutedFeedIds.filter((id): id is string => typeof id === 'string')
      ),
    ];
  }

  // The API key is intentionally not round-tripped through backups.
  return Object.keys(out).length ? out : undefined;
}

/** Keep only the fields the reader understands, so imported JSON cannot inject junk. */
function cleanBackupArticle(raw: unknown, feedId: string, oldFeedId: string): Article | null {
  if (!isRecord(raw)) return null;
  const originalId = stringValue(raw.id);
  if (!originalId) return null;

  const id =
    oldFeedId !== feedId && originalId.startsWith(`${oldFeedId}-`)
      ? `${feedId}-${originalId.slice(oldFeedId.length + 1)}`
      : originalId;

  const publishedAt = Number(raw.publishedAt);
  return {
    id,
    feedId,
    title: stringValue(raw.title) ?? '(untitled)',
    link: stringValue(raw.link),
    summary: stringValue(raw.summary) ?? '',
    contentHtml: stringValue(raw.contentHtml) ?? '',
    searchText: stringValue(raw.searchText),
    author: stringValue(raw.author),
    publishedAt: Number.isFinite(publishedAt) ? publishedAt : Date.now(),
    thumbnail: stringValue(raw.thumbnail),
    youtubeId: stringValue(raw.youtubeId),
    audioUrl: stringValue(raw.audioUrl),
    audioType: stringValue(raw.audioType),
  };
}

export function parseJsonBackup(text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ImportError('That file is not valid JSON.');
  }
  if (!isRecord(parsed)) {
    throw new ImportError('That JSON file is not an RSS Reader backup.');
  }

  const warnings: string[] = [];
  const rawFeeds = Array.isArray(parsed.feeds) ? parsed.feeds : [];
  const rawFolders = Array.isArray(parsed.folders) ? parsed.folders : [];
  if (!Array.isArray(parsed.feeds) && !Array.isArray(parsed.folders)) {
    throw new ImportError('That JSON file is not an RSS Reader backup.');
  }

  const feeds: ExportFeed[] = [];
  const folderNames = new Set<string>();
  const seen = new Set<string>();
  /** Backup feed id → id this device will use (URLs are hashed into ids). */
  const idMap = new Map<string, string>();

  // Explicit folder list first, so folders with no feeds survive.
  for (const entry of rawFolders) {
    const folder = stringValue(entry)?.trim();
    if (folder) folderNames.add(folder);
  }

  for (const entry of rawFeeds) {
    if (!isRecord(entry)) continue;
    const rawUrl = String(entry.url ?? '');
    const url = normalizeImportUrl(rawUrl);
    if (!url) {
      warnings.push(`Skipped an entry with an invalid URL: ${rawUrl.slice(0, 80)}`);
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);

    const folder = stringValue(entry.folder)?.trim() || undefined;
    if (folder) folderNames.add(folder);

    // Full backups carry the id so a restored feed keeps the same id even when
    // its stored URL was changed by redirect/discovery (see trackAlternate).
    const rawId = stringValue(entry.id) ?? '';
    const id = isFeedId(rawId) ? rawId : feedIdForUrl(url);
    if (rawId) idMap.set(rawId, id);

    const addedAt = Number(entry.addedAt);
    feeds.push({
      id,
      url,
      title: (stringValue(entry.title) ?? '').trim(),
      siteUrl: stringValue(entry.siteUrl) || undefined,
      folder,
      description: stringValue(entry.description),
      iconUrl: stringValue(entry.iconUrl),
      addedAt: Number.isFinite(addedAt) ? addedAt : undefined,
    });
  }

  const feedIds = new Set(feeds.map((feed) => feed.id ?? feedIdForUrl(feed.url)));
  const articles: Record<string, Article[]> = {};
  const articleIdMap = new Map<string, string>();
  let skippedArticles = 0;

  if (parsed.version === 2 && isRecord(parsed.articles)) {
    for (const [backupFeedId, list] of Object.entries(parsed.articles)) {
      const feedId = idMap.get(backupFeedId) ?? backupFeedId;
      if (!Array.isArray(list)) continue;
      if (!feedIds.has(feedId)) {
        skippedArticles += list.length;
        continue;
      }
      const cleaned: Article[] = [];
      for (const item of list.slice(0, BACKUP_ARTICLE_LIMIT)) {
        const article = cleanBackupArticle(item, feedId, backupFeedId);
        if (!article) continue;
        cleaned.push(article);
        const originalId = isRecord(item) ? stringValue(item.id) : undefined;
        if (originalId && originalId !== article.id) {
          articleIdMap.set(originalId, article.id);
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
  if (Array.isArray(parsed.readIds)) {
    for (const id of parsed.readIds) {
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

  const full = parsed.version === 2;
  return {
    feeds: sortImportedFeeds(feeds),
    readIds,
    format: 'json',
    warnings,
    folders: [...folderNames].sort(byName),
    ...(full
      ? {
          articles,
          preferences: parseBackupPreferences(parsed.preferences),
          full: true,
        }
      : {}),
  };
}
