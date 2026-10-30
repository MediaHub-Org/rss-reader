/**
 * Shared vocabulary for the import/export formats.
 *
 * OPML and the JSON backup use the same feed shape and the same validation
 * rules; keeping them here avoids the two parsers drifting apart.
 */
import type { Article, Preferences } from '../../types';

export interface ExportFeed {
  /** Stable id, only present in full backups (used to keep caches aligned). */
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

export class ImportError extends Error {}

/** Case/diacritic-insensitive A–Z ordering used everywhere feeds are listed. */
export function byName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

/**
 * Foldered feeds first (folders A–Z, feeds inside A–Z), then any ungrouped
 * feeds A–Z — matches the sidebar and OPML export order.
 */
export function sortImportedFeeds(feeds: ExportFeed[]): ExportFeed[] {
  return [...feeds].sort((a, b) => {
    const folderA = a.folder?.trim() ?? '';
    const folderB = b.folder?.trim() ?? '';
    if (Boolean(folderA) !== Boolean(folderB)) return folderA ? -1 : 1;
    const folderCmp = byName(folderA, folderB);
    if (folderCmp !== 0) return folderCmp;
    return byName(a.title || a.url, b.title || b.url);
  });
}

/** Validate and canonicalise a feed URL found in an imported file. */
export function normalizeImportUrl(raw: string): string | null {
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

/**
 * Folder names from explicit empty folders plus the ones feeds reference.
 * Sorted A–Z, blanks removed.
 */
export function collectFolderNames(
  feeds: Array<{ folder?: string }>,
  folders: string[]
): string[] {
  const names = new Set<string>(folders.map((name) => name.trim()).filter(Boolean));
  for (const feed of feeds) {
    const folder = feed.folder?.trim();
    if (folder) names.add(folder);
  }
  return [...names].sort(byName);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}
