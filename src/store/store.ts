import type {
  AppState,
  Article,
  Feed,
  FeedState,
  Preferences,
  SortMode,
  Toast,
  ToastKind,
} from '../types';
import { ALL_FEEDS, DEFAULT_PREFERENCES } from '../types';
import { feedIdForUrl, parseFeedXml, FeedParseError } from '../lib/feedParser';
import { fetchFeedDocument, FeedFetchError } from '../lib/fetchFeed';
import { normalizeFeedUrl } from '../lib/url';
import {
  loadFeeds,
  loadPreferences,
  loadReadIds,
  saveFeeds,
  savePreferences,
  saveReadIds,
  saveArticles,
  loadAllArticles,
  removeArticles,
} from '../lib/storage';

const HYDRATED_ARTICLE_LIMIT = 500;
const REFRESH_STAGGER_MS = 250;

let toastSeq = 0;

function initialState(): AppState {
  return {
    feeds: [],
    articles: {},
    feedState: {},
    readIds: {},
    prefs: { ...DEFAULT_PREFERENCES },
    ui: {
      activeFeedId: ALL_FEEDS,
      activeArticleId: null,
      sort: 'date-desc',
      query: '',
      sidebarOpen: false,
    },
    toasts: [],
    hydrated: false,
  };
}

export interface ActionResult {
  ok: boolean;
  message?: string;
}

/**
 * Plain, framework-agnostic store exposed to React through useSyncExternalStore.
 * Keeping state outside React means persistence and background refresh don't
 * depend on component lifetimes.
 */
export class Store {
  private state: AppState = initialState();
  private listeners = new Set<() => void>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private mediaQuery: MediaQueryList | null = null;
  private hydrationStarted = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AppState => this.state;

  private update(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      saveFeeds(this.state.feeds);
      saveReadIds(this.state.readIds);
      savePreferences(this.state.prefs);
      void Promise.all(
        Object.entries(this.state.articles).map(([feedId, articles]) => saveArticles(feedId, articles))
      );
    }, 400);
  }

  notify(kind: ToastKind, text: string): void {
    const toast: Toast = { id: ++toastSeq, kind, text };
    // Never stack notifications: show only the latest one and auto-close it.
    this.update({ toasts: [toast] });
    setTimeout(() => this.dismissToast(toast.id), 3500);
  }

  dismissToast(id: number): void {
    if (!this.state.toasts.some((t) => t.id === id)) return;
    this.update({ toasts: this.state.toasts.filter((t) => t.id !== id) });
  }

  /* --------------------------------- theme -------------------------------- */

  applyPreferences(prefs: Preferences): void {
    const root = document.documentElement;
    const dark =
      prefs.theme === 'dark' ||
      (prefs.theme === 'system' &&
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);

    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.density = prefs.density;
    root.dataset.fontSize = prefs.fontSize;
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';

    if (prefs.theme === 'system' && !this.mediaQuery && typeof window !== 'undefined') {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.mediaQuery.addEventListener('change', () => {
        this.applyPreferences(this.state.prefs);
      });
    }
  }

  setPreferences(patch: Partial<Preferences>): void {
    const prefs = { ...this.state.prefs, ...patch };
    this.update({ prefs });
    this.applyPreferences(prefs);
    savePreferences(prefs);
  }

  /* ------------------------------- hydration ------------------------------ */

  async hydrate(): Promise<void> {
    // React StrictMode mounts effects twice; only ever hydrate (and refresh) once.
    if (this.hydrationStarted) return;
    this.hydrationStarted = true;

    const prefs = loadPreferences();
    const feeds = loadFeeds();
    const readIds = loadReadIds();

    this.update({ prefs, feeds, readIds });
    this.applyPreferences(prefs);

    const cached = await loadAllArticles();
    const known = new Set(feeds.map((f) => f.id));
    const articles: Record<string, Article[]> = {};
    for (const [feedId, list] of Object.entries(cached)) {
      if (known.has(feedId)) articles[feedId] = list;
    }

    const feedState: Record<string, FeedState> = {};
    for (const feed of feeds) {
      const count = articles[feed.id]?.length ?? 0;
      feedState[feed.id] = { status: count ? 'ok' : 'idle', articleCount: count };
    }

    this.update({ articles, feedState, hydrated: true });

    if (feeds.length) await this.refreshAll({ silent: true });
  }

  /* -------------------------------- feeds --------------------------------- */

  private setFeedState(feedId: string, patch: Partial<FeedState>): void {
    const current: FeedState = this.state.feedState[feedId] ?? { status: 'idle', articleCount: 0 };
    this.update({
      feedState: { ...this.state.feedState, [feedId]: { ...current, ...patch } },
    });
  }

  async addFeed(rawUrl: string, folder?: string): Promise<ActionResult> {
    const validated = normalizeFeedUrl(rawUrl);
    if (!validated.ok) return { ok: false, message: validated.error };

    const url = validated.url;
    const feedId = feedIdForUrl(url);
    if (this.state.feeds.some((f) => f.id === feedId || f.url === url)) {
      return { ok: false, message: 'You are already subscribed to that feed.' };
    }

    const folderName = folder?.trim() || undefined;
    const placeholder: Feed = {
      id: feedId,
      url,
      title: url.replace(/^https?:\/\//, '').slice(0, 60),
      folder: folderName,
      addedAt: Date.now(),
    };
    this.update({
      feeds: [...this.state.feeds, placeholder],
      feedState: { ...this.state.feedState, [feedId]: { status: 'loading', articleCount: 0 } },
    });

    try {
      const { xml, finalUrl } = await fetchFeedDocument(url);
      const parsed = await parseFeedXml(xml, feedId);
      const feed: Feed = {
        ...placeholder,
        url,
        title: parsed.feed.title || placeholder.title,
        siteUrl: parsed.feed.siteUrl,
        description: parsed.feed.description,
        iconUrl: parsed.feed.iconUrl,
      };

      this.update({
        feeds: this.state.feeds.map((f) => (f.id === feedId ? feed : f)),
        articles: { ...this.state.articles, [feedId]: parsed.articles },
        feedState: {
          ...this.state.feedState,
          [feedId]: {
            status: 'ok',
            articleCount: parsed.articles.length,
            updatedAt: Date.now(),
          },
        },
      });
      if (finalUrl !== url) this.trackAlternate(url, finalUrl);
      this.schedulePersist();
      void saveArticles(feedId, parsed.articles);
      return { ok: true, message: `Subscribed to “${feed.title}”` };
    } catch (err) {
      const message =
        err instanceof FeedParseError || err instanceof FeedFetchError
          ? err.message
          : 'Something went wrong while reading that feed.';
      // Roll back: a feed that never loaded has no place in the list.
      this.update({
        feeds: this.state.feeds.filter((f) => f.id !== feedId),
        feedState: Object.fromEntries(
          Object.entries(this.state.feedState).filter(([id]) => id !== feedId)
        ),
        articles: Object.fromEntries(
          Object.entries(this.state.articles).filter(([id]) => id !== feedId)
        ),
      });
      return { ok: false, message };
    }
  }

  /** Remember a redirect target (e.g. homepage → feed) for future refreshes. */
  private trackAlternate(original: string, finalUrl: string): void {
    if (finalUrl === original) return;
    this.update({
      feeds: this.state.feeds.map((f) => (f.url === original ? { ...f, url: finalUrl } : f)),
    });
    this.schedulePersist();
  }

  async refreshFeed(feedId: string, options: { silent?: boolean } = {}): Promise<void> {
    const feed = this.state.feeds.find((f) => f.id === feedId);
    if (!feed) return;

    this.setFeedState(feedId, { status: 'loading' });
    try {
      const { xml } = await fetchFeedDocument(feed.url);
      const parsed = await parseFeedXml(xml, feedId);
      const existing = this.state.articles[feedId] ?? [];
      const seen = new Set(existing.map((a) => a.id));
      const merged = [...existing];
      for (const article of parsed.articles) {
        if (!seen.has(article.id)) {
          seen.add(article.id);
          merged.push(article);
        }
      }
      merged.sort((a, b) => b.publishedAt - a.publishedAt);

      const truncated = merged.slice(0, HYDRATED_ARTICLE_LIMIT);
      this.update({
        articles: { ...this.state.articles, [feedId]: truncated },
        feedState: {
          ...this.state.feedState,
          [feedId]: { status: 'ok', updatedAt: Date.now(), articleCount: truncated.length },
        },
        feeds: this.state.feeds.map((f) =>
          f.id === feedId
            ? {
                ...f,
                title: f.title.startsWith('http') ? parsed.feed.title : f.title,
                siteUrl: f.siteUrl ?? parsed.feed.siteUrl,
                iconUrl: f.iconUrl ?? parsed.feed.iconUrl,
                description: f.description ?? parsed.feed.description,
              }
            : f
        ),
      });
      void saveArticles(feedId, truncated);
      this.schedulePersist();
    } catch (err) {
      const message =
        err instanceof FeedFetchError || err instanceof FeedParseError
          ? err.message
          : 'Refresh failed.';
      this.setFeedState(feedId, { status: 'error', message });
      if (!options.silent) this.notify('error', message);
    }
  }

  async refreshAll(options: { silent?: boolean } = {}): Promise<void> {
    const feeds = this.state.feeds;
    if (!feeds.length) return;
    await Promise.all(
      feeds.map(
        (feed, index) =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              // Individual feed refreshes during a bulk refresh stay silent so
              // unreachable feeds never spam error banners/toasts.
              void this.refreshFeed(feed.id, { silent: true }).finally(resolve);
            }, index * REFRESH_STAGGER_MS);
          })
      )
    );
    if (!options.silent) this.notify('success', 'Feeds updated');
  }

  removeFeed(feedId: string): void {
    const feed = this.state.feeds.find((f) => f.id === feedId);
    if (!feed) return;
    this.removeFeeds([feedId], { silent: true });
    this.notify('success', `Unsubscribed from “${feed.title}”`);
  }

  /**
   * Bulk-remove any set of feeds (one, several, all, or an entire folder) in a
   * single state update and clean up their cached articles.
   */
  removeFeeds(feedIds: string[], options: { silent?: boolean } = {}): number {
    const toRemove = new Set(feedIds);
    const remaining = this.state.feeds.filter((f) => !toRemove.has(f.id));
    const removedCount = this.state.feeds.length - remaining.length;
    if (removedCount === 0) return 0;

    const articles = { ...this.state.articles };
    const feedState = { ...this.state.feedState };
    for (const id of toRemove) {
      delete articles[id];
      delete feedState[id];
      void removeArticles(id);
    }

    const activeGone =
      this.state.ui.activeFeedId !== null && toRemove.has(this.state.ui.activeFeedId);

    this.update({
      feeds: remaining,
      articles,
      feedState,
      ui: activeGone
        ? { ...this.state.ui, activeFeedId: ALL_FEEDS, activeArticleId: null }
        : this.state.ui,
    });
    this.schedulePersist();
    if (!options.silent) {
      this.notify(
        'success',
        `Removed ${removedCount} feed${removedCount === 1 ? '' : 's'}`
      );
    }
    return removedCount;
  }

  /** Delete an entire folder along with all feeds inside it. */
  removeFolder(folderName: string): number {
    const target = folderName.trim();
    const ids = this.state.feeds
      .filter((f) => (f.folder?.trim() ?? '') === target)
      .map((f) => f.id);
    const removed = this.removeFeeds(ids, { silent: true });
    if (removed > 0) {
      this.notify(
        'success',
        `Removed folder “${target}” (${removed} feed${removed === 1 ? '' : 's'})`
      );
    }
    return removed;
  }

  /* ------------------------------ subscriptions --------------------------- */

  /**
   * Merge or sync imported subscriptions.
   * - Existing feeds whose title, folder or siteUrl changed in the OPML are
   *   updated in place (so editing the OPML XML and re-importing works).
   * - Unchanged existing feeds are counted as `skipped`.
   * - With `replace: true` (OPML XML editor), feeds omitted from `incoming`
   *   are also removed.
   */
  importFeeds(
    incoming: Array<{ url: string; title?: string; siteUrl?: string; folder?: string }>,
    options: { replace?: boolean } = {}
  ): { added: number; updated: number; removed: number; skipped: number } {
    const existingById = new Map(this.state.feeds.map((f) => [f.id, f]));
    const seen = new Set<string>();
    const added: Feed[] = [];
    const updatedById = new Map<string, Feed>();
    let skipped = 0;

    for (const entry of incoming) {
      const validated = normalizeFeedUrl(entry.url);
      if (!validated.ok) {
        skipped++;
        continue;
      }
      const id = feedIdForUrl(validated.url);
      if (seen.has(id)) {
        skipped++;
        continue;
      }
      seen.add(id);

      const nextFolder = entry.folder?.trim() || undefined;
      const prev = existingById.get(id);
      if (prev) {
        const nextTitle = entry.title?.trim() || prev.title;
        const nextSite = entry.siteUrl || prev.siteUrl;
        const changed =
          nextTitle !== prev.title ||
          (nextFolder ?? '') !== (prev.folder?.trim() ?? '') ||
          nextSite !== prev.siteUrl;
        if (changed) {
          updatedById.set(id, {
            ...prev,
            title: nextTitle,
            folder: nextFolder,
            siteUrl: nextSite,
          });
        } else {
          skipped++;
        }
        continue;
      }

      added.push({
        id,
        url: validated.url,
        title: entry.title?.trim() || validated.url.replace(/^https?:\/\//, ''),
        siteUrl: entry.siteUrl,
        folder: nextFolder,
        addedAt: Date.now(),
      });
    }

    let removed = 0;
    if (options.replace) {
      const toRemove = this.state.feeds
        .filter((f) => !seen.has(f.id))
        .map((f) => f.id);
      removed = this.removeFeeds(toRemove, { silent: true });
    }

    if (added.length || updatedById.size) {
      const nextFeeds = [
        ...this.state.feeds.map((f) => updatedById.get(f.id) ?? f),
        ...added,
      ];
      this.update({
        feeds: nextFeeds,
        feedState: {
          ...this.state.feedState,
          ...Object.fromEntries(
            added.map((f) => [f.id, { status: 'idle' as const, articleCount: 0 }])
          ),
        },
      });
      this.schedulePersist();
      void added.forEach((feed, index) => {
        setTimeout(() => void this.refreshFeed(feed.id, { silent: true }), index * REFRESH_STAGGER_MS);
      });
    }

    return { added: added.length, updated: updatedById.size, removed, skipped };
  }

  mergeReadIds(readIds: Record<string, true>): number {
    const merged = { ...this.state.readIds, ...readIds };
    const count = Object.keys(readIds).length;
    this.update({ readIds: merged });
    saveReadIds(merged);
    return count;
  }

  /* ------------------------------ read status ----------------------------- */

  setRead(articleIds: string[], read: boolean): void {
    if (!articleIds.length) return;
    const next = { ...this.state.readIds };
    for (const id of articleIds) {
      if (read) next[id] = true;
      else delete next[id];
    }
    this.update({ readIds: next });
    this.schedulePersist();
  }

  toggleRead(articleId: string): void {
    this.setRead([articleId], !this.state.readIds[articleId]);
  }

  markAllRead(articleIds: string[]): void {
    this.setRead(articleIds, true);
  }

  markAllUnread(articleIds: string[]): void {
    this.setRead(articleIds, false);
  }

  /* ----------------------------------- UI --------------------------------- */

  setActiveFeed(feedId: string | null): void {
    this.update({
      ui: { ...this.state.ui, activeFeedId: feedId ?? ALL_FEEDS, activeArticleId: null },
    });
  }

  setActiveArticle(articleId: string | null): void {
    this.update({ ui: { ...this.state.ui, activeArticleId: articleId } });
  }

  setSort(sort: SortMode): void {
    this.update({ ui: { ...this.state.ui, sort } });
  }

  setQuery(query: string): void {
    this.update({ ui: { ...this.state.ui, query } });
  }

  setSidebarOpen(sidebarOpen: boolean): void {
    this.update({ ui: { ...this.state.ui, sidebarOpen } });
  }
}

export const store = new Store();

/** Resolve the effective theme from preferences (system → OS preference). */
export function isDarkTheme(prefs: Preferences): boolean {
  if (prefs.theme === 'dark') return true;
  if (prefs.theme === 'light') return false;
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/* --------------------------------- selectors ------------------------------- */

export function unreadCount(state: AppState, feedId: string): number {
  const ids =
    feedId === ALL_FEEDS
      ? Object.values(state.articles).flat()
      : (state.articles[feedId] ?? []);
  return ids.reduce((sum, article) => (state.readIds[article.id] ? sum : sum + 1), 0);
}

/** Every article in scope (one feed, or all), filtered, sorted, and query-matched. */
export function selectArticles(
  state: AppState,
  options: { feedId: string | null; sort: SortMode; query: string; hideRead?: boolean }
): Article[] {
  const feedId = options.feedId ?? ALL_FEEDS;
  const source =
    feedId === ALL_FEEDS ? Object.values(state.articles).flat() : (state.articles[feedId] ?? []);

  const needle = options.query.trim().toLowerCase();
  let list = source;

  if (options.hideRead) list = list.filter((a) => !state.readIds[a.id]);

  if (needle) {
    list = list.filter(
      (a) =>
        a.title.toLowerCase().includes(needle) ||
        a.summary.toLowerCase().includes(needle) ||
        (a.author ?? '').toLowerCase().includes(needle)
    );
  }

  const feedTitle = (id: string) => state.feeds.find((f) => f.id === id)?.title ?? '';

  const sorted = [...list];
  switch (options.sort) {
    case 'date-asc':
      sorted.sort((a, b) => a.publishedAt - b.publishedAt);
      break;
    case 'feed':
      sorted.sort((a, b) => {
        const byFeed = feedTitle(a.feedId).localeCompare(feedTitle(b.feedId));
        return byFeed !== 0 ? byFeed : b.publishedAt - a.publishedAt;
      });
      break;
    default:
      sorted.sort((a, b) => b.publishedAt - a.publishedAt);
  }
  return sorted;
}
