/**
 * Desktop automatic backups.
 *
 * The renderer serializes the same full backup used by Export, then Rust stores
 * it under the app data directory and keeps the newest seven files. The web
 * build reports no backups; manual Export remains available there.
 */
import { invokeDesktop, isDesktopApp } from './desktop';
import { exportFullBackup } from './portability';
import { loadAllArticles } from './storage';
import { store } from '../store/store';
import type { Article } from '../types';

export interface AutoBackupInfo {
  name: string;
  bytes: number;
  createdAt: number;
}

export interface AutoBackupList {
  directory: string;
  items: AutoBackupInfo[];
}

export const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const AUTO_BACKUP_CHECK_MS = 6 * 60 * 60 * 1000;

let running = false;

/**
 * IndexedDB is written asynchronously after a fetch; if a snapshot runs in the
 * gap, merge the in-memory articles in so the file is never missing what is
 * already on screen.
 */
async function collectArticles(): Promise<Record<string, Article[]>> {
  const cached = await loadAllArticles();
  const state = store.getSnapshot();
  for (const [feedId, list] of Object.entries(state.articles)) {
    if (!list.length) continue;
    const existing = cached[feedId] ?? [];
    const known = new Set(existing.map((article) => article.id));
    const missing = list.filter((article) => !known.has(article.id));
    if (missing.length) {
      cached[feedId] = [...existing, ...missing].sort(
        (a, b) => b.publishedAt - a.publishedAt
      );
    }
  }
  return cached;
}

export function autoBackupsAvailable(): boolean {
  return isDesktopApp();
}

export async function listAutoBackups(): Promise<AutoBackupList> {
  if (!isDesktopApp()) return { directory: '', items: [] };
  return invokeDesktop<AutoBackupList>('list_auto_backups');
}

export async function createAutoBackup(): Promise<AutoBackupInfo> {
  if (!isDesktopApp()) {
    throw new Error('Automatic backups are only available in the desktop app.');
  }
  const state = store.getSnapshot();
  const articles = await collectArticles();
  const contents = exportFullBackup(
    state.feeds,
    state.readIds,
    state.folders,
    state.prefs,
    articles,
    state.starredIds,
    state.rules
  );
  return invokeDesktop<AutoBackupInfo>('create_auto_backup', { contents });
}

export async function readAutoBackup(name: string): Promise<string> {
  return invokeDesktop<string>('read_auto_backup', { name });
}

export async function deleteAutoBackup(name: string): Promise<void> {
  await invokeDesktop('delete_auto_backup', { name });
}

/**
 * Create a snapshot when the newest one is older than a day. Called on launch
 * and while the app stays open; silent by design.
 */
export async function maybeAutoBackup(): Promise<AutoBackupInfo | null> {
  if (!isDesktopApp() || running) return null;
  const state = store.getSnapshot();
  if (!state.hydrated || state.feeds.length === 0) return null;
  // Do not snapshot while a feed is being fetched: the cache may still be
  // missing the articles that are about to land.
  if (Object.values(state.feedState).some((status) => status.status === 'loading')) return null;

  running = true;
  try {
    const list = await listAutoBackups();
    const newest = list.items[0]?.createdAt ?? 0;
    if (Date.now() - newest < AUTO_BACKUP_INTERVAL_MS) return null;
    return await createAutoBackup();
  } catch (err) {
    console.warn('Automatic backup failed', err);
    return null;
  } finally {
    running = false;
  }
}
