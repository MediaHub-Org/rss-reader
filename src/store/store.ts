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
import {
  ALL_FEEDS,
  DEFAULT_PREFERENCES,
  folderNameFromViewId,
  folderViewId,
} from '../types';
import { feedIdForUrl, FeedParseError } from '../lib/feedParser';
import { resolveImportedFeedId } from '../lib/feedId';
import { fetchFeedArticles, FeedFetchError } from '../lib/fetchFeed';
import { normalizeFeedUrl } from '../lib/url';
import {
  loadFeeds,
  loadFolders,
  loadPreferences,
  loadReadIds,
  saveFeeds,
  saveFolders,
  savePreferences,
  saveReadIds,
  saveArticles,
  loadAllArticles,
  removeArticles,
  clearArticleCache,
} from '../lib/storage';

const HYDRATED_ARTICLE_LIMIT = 500;
const REFRESH_STAGGER_MS = 250;

let toastSeq = 0;

function initialState(): AppState {
  return {
    feeds: [],
    folders: [],
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
      saveFolders(this.state.folders);
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
    const folders = loadFolders();
    const readIds = loadReadIds();

    this.update({ prefs, feeds, folders, readIds });
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
      const { parsed, finalUrl } = await fetchFeedArticles(url, feedId, this.state.prefs.youtubeApiKey);
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
      const { parsed } = await fetchFeedArticles(feed.url, feedId, this.state.prefs.youtubeApiKey);
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

    const activeFolder = folderNameFromViewId(this.state.ui.activeFeedId);
    const activeGone =
      this.state.ui.activeFeedId !== null &&
      (toRemove.has(this.state.ui.activeFeedId) ||
        (activeFolder !== null &&
          !remaining.some((f) => f.folder === activeFolder) &&
          !this.state.folders.includes(activeFolder)));

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

  /**
   * Create an empty folder, so it shows in the sidebar before any feed is
   * put in it. Adding a feed to a folder name that doesn't exist yet (via
   * addFeed/updateFeed) already makes it show up on its own -- this is only
   * for the "start empty, add feeds later" order.
   */
  createFolder(name: string): ActionResult {
    const target = name.trim();
    if (!target) return { ok: false, message: 'Folder name cannot be empty.' };
    const exists =
      this.state.folders.includes(target) || this.state.feeds.some((f) => f.folder?.trim() === target);
    if (exists) return { ok: false, message: `A folder named "${target}" already exists.` };

    this.update({ folders: [...this.state.folders, target] });
    this.schedulePersist();
    return { ok: true };
  }

  /** Delete a folder: every feed inside it (if any), and the empty-folder record itself. */
  removeFolder(folderName: string): number {
    const target = folderName.trim();
    const ids = this.state.feeds
      .filter((f) => (f.folder?.trim() ?? '') === target)
      .map((f) => f.id);
    const hadEmptyRecord = this.state.folders.includes(target);
    const removed = ids.length ? this.removeFeeds(ids, { silent: true }) : 0;

    // removeFeeds leaves a folder view alone while the explicit empty-folder
    // record still exists, so re-check after both removals and fall back to
    // "All articles" rather than leaving the sidebar on a folder that's gone.
    const stillActive = folderNameFromViewId(this.state.ui.activeFeedId) === target;
    if (hadEmptyRecord || stillActive) {
      this.update({
        folders: hadEmptyRecord
          ? this.state.folders.filter((f) => f !== target)
          : this.state.folders,
        ui: stillActive
          ? { ...this.state.ui, activeFeedId: ALL_FEEDS, activeArticleId: null }
          : this.state.ui,
      });
      this.schedulePersist();
    }

    if (this.state.prefs.collapsedFolders.includes(target)) {
      this.setPreferences({
        collapsedFolders: this.state.prefs.collapsedFolders.filter((name) => name !== target),
      });
    }

    if (removed > 0 || hadEmptyRecord) {
      this.notify(
        'success',
        removed > 0
          ? `Removed folder “${target}” (${removed} feed${removed === 1 ? '' : 's'})`
          : `Removed folder “${target}”`
      );
    }
    return removed;
  }

  /** Rename a feed's display title (its id stays derived from the feed URL). */
  renameFeed(feedId: string, title: string): ActionResult {
    const next = title.trim();
    if (!next) return { ok: false, message: 'Feed name cannot be empty.' };
    const feed = this.state.feeds.find((f) => f.id === feedId);
    if (!feed) return { ok: false, message: 'Feed not found.' };
    if (next === feed.title) return { ok: true };

    this.update({
      feeds: this.state.feeds.map((f) => (f.id === feedId ? { ...f, title: next } : f)),
    });
    this.schedulePersist();
    return { ok: true };
  }

  /** Move a feed into a different folder, or ungroup it with `folder: undefined`. */
  moveFeedToFolder(feedId: string, folder: string | undefined): ActionResult {
    const feed = this.state.feeds.find((f) => f.id === feedId);
    if (!feed) return { ok: false, message: 'Feed not found.' };
    const next = folder?.trim() || undefined;
    if ((feed.folder?.trim() || undefined) === next) return { ok: true };

    this.update({
      feeds: this.state.feeds.map((f) => (f.id === feedId ? { ...f, folder: next } : f)),
    });
    this.schedulePersist();
    return { ok: true };
  }

  /**
   * Move several feeds at once, in a single state update. Feeds already in the
   * destination are skipped, so the return value is the number that changed.
   */
  moveFeedsToFolder(feedIds: string[], folder: string | undefined): number {
    const next = folder?.trim() || undefined;
    const targets = new Set(feedIds);
    let changed = 0;

    const feeds = this.state.feeds.map((feed) => {
      if (!targets.has(feed.id)) return feed;
      if ((feed.folder?.trim() || undefined) === next) return feed;
      changed += 1;
      return { ...feed, folder: next };
    });

    if (!changed) return 0;
    this.update({ feeds });
    this.schedulePersist();
    return changed;
  }

  /**
   * Merge folders: every feed in `sources` moves to `target` (or becomes
   * ungrouped when it is undefined) and the source folder records disappear.
   * One update, one notification.
   */
  mergeFolders(
    sources: string[],
    target: string | undefined
  ): { feeds: number; folders: number } {
    const next = target?.trim() || undefined;
    const sourceSet = new Set(
      sources.map((name) => name.trim()).filter((name) => name && name !== next)
    );
    if (!sourceSet.size) return { feeds: 0, folders: 0 };

    let moved = 0;
    const feeds = this.state.feeds.map((feed) => {
      if (!sourceSet.has(feed.folder?.trim() ?? '')) return feed;
      moved += 1;
      return { ...feed, folder: next };
    });

    const removedRecords = this.state.folders.filter((name) => sourceSet.has(name));
    let folders = this.state.folders.filter((name) => !sourceSet.has(name));

    // Keep an otherwise-empty destination visible after the merge.
    if (next && !folders.includes(next) && !feeds.some((f) => f.folder === next)) {
      folders = [...folders, next];
    }

    if (moved || removedRecords.length) {
      const activeFolder = folderNameFromViewId(this.state.ui.activeFeedId);
      const activeMoved = activeFolder !== null && sourceSet.has(activeFolder);

      this.update({
        feeds,
        folders,
        ui: activeMoved
          ? {
              ...this.state.ui,
              activeFeedId: next ? folderViewId(next) : ALL_FEEDS,
              activeArticleId: null,
            }
          : this.state.ui,
      });
      this.schedulePersist();
    }

    const collapsed = this.state.prefs.collapsedFolders;
    const nextCollapsed = collapsed.filter((name) => !sourceSet.has(name));
    if (nextCollapsed.length !== collapsed.length) {
      this.setPreferences({ collapsedFolders: nextCollapsed });
    }

    const folderCount = removedRecords.length || sourceSet.size;
    if (moved || folderCount) {
      this.notify(
        'success',
        next
          ? `Merged ${folderCount} folder${folderCount === 1 ? '' : 's'} into “${next}” (${
              moved === 1 ? '1 feed' : `${moved} feeds`
            })`
          : `Removed ${folderCount} folder${folderCount === 1 ? '' : 's'}; ${moved} feed${
              moved === 1 ? '' : 's'
            } now ungrouped`
      );
    }

    return { feeds: moved, folders: folderCount };
  }

  /**
   * Delete several folders in one go: their feeds, their records, their
   * collapsed state, and any view pointing at them. One notification.
   */
  removeFolders(folderNames: string[]): { folders: number; feeds: number } {
    const targets = new Set(folderNames.map((name) => name.trim()).filter(Boolean));
    if (!targets.size) return { folders: 0, feeds: 0 };

    const affected = this.state.feeds.filter((feed) =>
      targets.has(feed.folder?.trim() ?? '')
    );
    const namesWithFeeds = new Set(affected.map((feed) => feed.folder!.trim()));
    const removedRecords = this.state.folders.filter((name) => targets.has(name));
    const removed = affected.length
      ? this.removeFeeds(
          affected.map((feed) => feed.id),
          { silent: true }
        )
      : 0;

    const activeFolder = folderNameFromViewId(this.state.ui.activeFeedId);
    const activeGone = activeFolder !== null && targets.has(activeFolder);

    this.update({
      folders: this.state.folders.filter((name) => !targets.has(name)),
      ui: activeGone
        ? { ...this.state.ui, activeFeedId: ALL_FEEDS, activeArticleId: null }
        : this.state.ui,
    });
    this.schedulePersist();

    const collapsed = this.state.prefs.collapsedFolders;
    const nextCollapsed = collapsed.filter((name) => !targets.has(name));
    if (nextCollapsed.length !== collapsed.length) {
      this.setPreferences({ collapsedFolders: nextCollapsed });
    }

    const folderCount = new Set([...removedRecords, ...namesWithFeeds]).size;
    if (folderCount) {
      this.notify(
        'success',
        `Removed ${folderCount} folder${folderCount === 1 ? '' : 's'}${
          removed ? ` (${removed} feed${removed === 1 ? '' : 's'})` : ''
        }`
      );
    }

    return { folders: folderCount, feeds: removed };
  }

  /**
   * Rename a folder: updates the explicit empty-folder record (if any) and
   * every feed currently in it. Blocks renaming onto an existing folder's
   * name, same collision rule as createFolder.
   */
  renameFolder(oldName: string, newName: string): ActionResult {
    const from = oldName.trim();
    const to = newName.trim();
    if (!to) return { ok: false, message: 'Folder name cannot be empty.' };
    if (to === from) return { ok: true };
    const collision =
      this.state.folders.includes(to) || this.state.feeds.some((f) => f.folder?.trim() === to);
    if (collision) return { ok: false, message: `A folder named "${to}" already exists.` };

    const collapsed = this.state.prefs.collapsedFolders;
    const nextCollapsed = collapsed.includes(from)
      ? collapsed.map((name) => (name === from ? to : name))
      : collapsed;
    const activeFolder = folderNameFromViewId(this.state.ui.activeFeedId);

    this.update({
      folders: this.state.folders.map((f) => (f === from ? to : f)),
      feeds: this.state.feeds.map((f) =>
        (f.folder?.trim() ?? '') === from ? { ...f, folder: to } : f
      ),
      ui:
        activeFolder === from
          ? { ...this.state.ui, activeFeedId: folderViewId(to) }
          : this.state.ui,
    });
    if (nextCollapsed !== collapsed) {
      this.setPreferences({ collapsedFolders: nextCollapsed });
    }
    this.schedulePersist();
    return { ok: true };
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
    incoming: Array<{
      url: string;
      /** Stable id from a full backup; keeps caches/read state aligned. */
      id?: string;
      title?: string;
      siteUrl?: string;
      folder?: string;
      description?: string;
      iconUrl?: string;
      addedAt?: number;
    }>,
    options: { replace?: boolean; folders?: string[]; skipRefresh?: boolean } = {}
  ): { added: number; updated: number; removed: number; skipped: number } {
    const existingById = new Map(this.state.feeds.map((f) => [f.id, f]));
    const existingByUrl = new Map(this.state.feeds.map((f) => [f.url, f]));
    const seen = new Set<string>();
    const seenUrls = new Set<string>();
    const added: Feed[] = [];
    const updatedById = new Map<string, Feed>();
    let skipped = 0;

    for (const entry of incoming) {
      const validated = normalizeFeedUrl(entry.url);
      if (!validated.ok) {
        skipped++;
        continue;
      }
      if (seenUrls.has(validated.url)) {
        skipped++;
        continue;
      }
      seenUrls.add(validated.url);

      /**
       * A feed's id normally comes from its URL, but redirect/discovery can
       * change the stored URL without changing the id (trackAlternate). Full
       * backups carry that id so a restore does not add a duplicate; OPML has
       * no id, so an existing feed with the same URL supplies it instead.
       */
      const id = resolveImportedFeedId(entry.id, validated.url, existingById, existingByUrl);
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
            description: entry.description ?? prev.description,
            iconUrl: entry.iconUrl ?? prev.iconUrl,
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
        addedAt: Number.isFinite(entry.addedAt) ? entry.addedAt! : Date.now(),
        description: entry.description,
        iconUrl: entry.iconUrl,
      });
    }

    let removed = 0;
    if (options.replace) {
      const toRemove = this.state.feeds
        .filter((f) => !seen.has(f.id))
        .map((f) => f.id);
      removed = this.removeFeeds(toRemove, { silent: true });
    }

    /**
     * Explicit folder names from the source file keep empty folders alive
     * through an export → import round-trip. On a replace (OPML XML editor)
     * the file becomes the whole folder list, so deleted folders disappear
     * too; on a merge we only add the new names.
     */
    const folderSet = new Set<string>(options.replace ? [] : this.state.folders);
    for (const entry of incoming) {
      const folder = entry.folder?.trim();
      if (folder) folderSet.add(folder);
    }
    for (const name of options.folders ?? []) {
      const folder = name.trim();
      if (folder) folderSet.add(folder);
    }
    const nextFolders = [...folderSet];
    const foldersChanged =
      nextFolders.length !== this.state.folders.length ||
      nextFolders.some((name) => !this.state.folders.includes(name));

    if (added.length || updatedById.size || foldersChanged) {
      const nextFeeds = [
        ...this.state.feeds.map((f) => updatedById.get(f.id) ?? f),
        ...added,
      ];
      this.update({
        feeds: nextFeeds,
        folders: nextFolders,
        feedState: {
          ...this.state.feedState,
          ...Object.fromEntries(
            added.map((f) => [f.id, { status: 'idle' as const, articleCount: 0 }])
          ),
        },
      });

      // Drop collapsed-state entries for folders that no longer exist.
      const existingFolders = new Set(nextFolders);
      const collapsed = this.state.prefs.collapsedFolders;
      const nextCollapsed = collapsed.filter((name) => existingFolders.has(name));
      if (nextCollapsed.length !== collapsed.length) {
        this.setPreferences({ collapsedFolders: nextCollapsed });
      }

      this.schedulePersist();
      if (!options.skipRefresh) {
        void added.forEach((feed, index) => {
          setTimeout(() => void this.refreshFeed(feed.id, { silent: true }), index * REFRESH_STAGGER_MS);
        });
      }
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

  /** Replace the whole read map, used by a full backup restore. */
  replaceReadIds(readIds: Record<string, true>): number {
    const next = { ...readIds };
    this.update({ readIds: next });
    saveReadIds(next);
    return Object.keys(next).length;
  }

  /**
   * Restore the article cache from a full backup. Every article is written to
   * IndexedDB, while the in-memory view keeps the newest HYDRATED_ARTICLE_LIMIT
   * per feed — the same shape hydration and refresh produce.
   *
   * `replace` clears the existing cache first, so a snapshot restore is exact.
   */
  async restoreArticles(
    incoming: Record<string, Article[]>,
    options: { replace?: boolean } = {}
  ): Promise<number> {
    if (options.replace) await clearArticleCache();

    const knownFeeds = new Set(this.state.feeds.map((feed) => feed.id));
    const visible: Record<string, Article[]> = {};
    let total = 0;

    for (const [feedId, list] of Object.entries(incoming)) {
      if (!knownFeeds.has(feedId) || !Array.isArray(list) || !list.length) continue;
      const clean = list
        .filter((article) => article && typeof article.id === 'string')
        .map((article) => ({ ...article, feedId }))
        .sort((a, b) => b.publishedAt - a.publishedAt);
      if (!clean.length) continue;

      total += clean.length;
      visible[feedId] = clean.slice(0, HYDRATED_ARTICLE_LIMIT);
      await saveArticles(feedId, clean);
    }

    if (!total) {
      if (options.replace) this.update({ articles: {}, feedState: {} });
      return 0;
    }

    const feedState: Record<string, FeedState> = options.replace
      ? {}
      : { ...this.state.feedState };
    for (const [feedId, list] of Object.entries(visible)) {
      feedState[feedId] = {
        ...(feedState[feedId] ?? { status: 'ok', articleCount: 0 }),
        status: 'ok',
        updatedAt: Date.now(),
        articleCount: list.length,
      };
    }
    this.update({
      articles: options.replace ? visible : { ...this.state.articles, ...visible },
      feedState,
    });
    this.schedulePersist();
    return total;
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

  /**
   * Replay a view from browser history: sets feed and article in one update so
   * the history effect sees a single transition (and does not push again).
   * Returns whether anything actually changed.
   */
  applyView(activeFeedId: string, activeArticleId: string | null): boolean {
    const ui = this.state.ui;
    if (ui.activeFeedId === activeFeedId && ui.activeArticleId === activeArticleId) {
      return false;
    }
    this.update({ ui: { ...ui, activeFeedId, activeArticleId } });
    return true;
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
  const folderName = folderNameFromViewId(feedId);
  const source =
    feedId === ALL_FEEDS
      ? Object.values(state.articles).flat()
      : folderName !== null
        ? state.feeds
            .filter((f) => f.folder === folderName)
            .flatMap((f) => state.articles[f.id] ?? [])
        : (state.articles[feedId] ?? []);

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
