/**
 * Persistence layer.
 *
 *  - preferences, subscriptions and read-state  → localStorage (small, synchronous)
 *  - cached articles                           → IndexedDB (large, quota-friendly)
 *
 * Everything is namespaced under `rss-reader:` so the app never collides with
 * other origins sharing the same storage.
 */
import type { Article, Feed, Preferences } from '../types';
import { DEFAULT_PREFERENCES } from '../types';

const NS = 'rss-reader:';
/** Schema revision for preferences; bump when a one-time migration is added. */
const PREFS_VERSION = 2;
const KEYS = {
  prefs: `${NS}prefs`,
  feeds: `${NS}feeds`,
  folders: `${NS}folders`,
  read: `${NS}read`,
  version: `${NS}version`,
} as const;

const DB_NAME = 'rss-reader';
const DB_VERSION = 1;
const STORE = 'articles';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // Quota pressure: drop the bulk cache rather than lose subscriptions.
    console.warn('localStorage write failed, evicting article cache', err);
    clearArticleCache();
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* give up silently — in-memory state stays correct */
    }
  }
}

export function loadPreferences(): Preferences {
  const stored = readJson<Partial<Preferences>>(KEYS.prefs, {});
  const storedVersion = typeof stored.prefsVersion === 'number' ? stored.prefsVersion : 0;
  const prefs = { ...DEFAULT_PREFERENCES, ...stored };
  return {
    ...prefs,
    prefsVersion: PREFS_VERSION,
    // Version 1 stored the old YouTube-only option: it defaulted to off, and
    // the first release of the wider inline-media feature carried that off
    // over as if it had been chosen, so existing profiles never saw a player.
    // Upgrade those profiles once to the new default. From v2 on, the toggle
    // is saved with the current version and an explicit choice wins.
    embedMedia: storedVersion < PREFS_VERSION ? DEFAULT_PREFERENCES.embedMedia : prefs.embedMedia,
    collapsedFolders: Array.isArray(prefs.collapsedFolders)
      ? [...new Set(prefs.collapsedFolders.map((name) => String(name ?? '').trim()).filter(Boolean))]
      : [],
  };
}

export function savePreferences(prefs: Preferences): void {
  writeJson(KEYS.prefs, prefs);
}

export function loadFeeds(): Feed[] {
  const feeds = readJson<Feed[]>(KEYS.feeds, []);
  return Array.isArray(feeds) ? feeds.filter((f) => f && f.id && f.url) : [];
}

export function saveFeeds(feeds: Feed[]): void {
  writeJson(KEYS.feeds, feeds);
}

export function loadFolders(): string[] {
  const folders = readJson<string[]>(KEYS.folders, []);
  return Array.isArray(folders)
    ? [...new Set(folders.map((f) => String(f ?? '').trim()).filter(Boolean))]
    : [];
}

export function saveFolders(folders: string[]): void {
  writeJson(KEYS.folders, [...new Set(folders.map((f) => f.trim()).filter(Boolean))]);
}

export function loadReadIds(): Record<string, true> {
  const read = readJson<Record<string, true> | string[]>(KEYS.read, {});
  if (Array.isArray(read)) {
    return Object.fromEntries(read.map((id) => [id, true] as const));
  }
  return read && typeof read === 'object' ? read : {};
}

export function saveReadIds(read: Record<string, true>): void {
  const keys = Object.keys(read);
  // Cap stored state so a decade of reading can't exhaust the origin quota.
  let payload: Record<string, true> = read;
  if (keys.length > 20_000) {
    payload = {};
    for (const id of keys.slice(-20_000)) payload[id] = true;
  }
  writeJson(KEYS.read, payload);
}

/* ----------------------------- IndexedDB cache ---------------------------- */

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'feedId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

export async function saveArticles(feedId: string, articles: Article[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ feedId, articles, savedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* cache is best-effort */
  }
}

export async function loadArticles(feedId: string): Promise<Article[]> {
  try {
    const db = await openDb();
    return await new Promise<Article[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(feedId);
      req.onsuccess = () => resolve(req.result?.articles ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function loadAllArticles(): Promise<Record<string, Article[]>> {
  try {
    const db = await openDb();
    const rows = await new Promise<Array<{ feedId: string; articles: Article[] }>>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
    return Object.fromEntries(rows.map((row) => [row.feedId, row.articles]));
  } catch {
    return {};
  }
}

export async function removeArticles(feedId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(feedId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

export async function clearArticleCache(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

/** Storage footprint in bytes, for the settings screen. */
export function estimateUsage(): { used: number; quota: number } {
  try {
    const used = Object.values(localStorage).reduce((sum, v) => sum + v.length * 2, 0);
    return { used, quota: 5 * 1024 * 1024 };
  } catch {
    return { used: 0, quota: 0 };
  }
}
