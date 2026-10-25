/** Domain types shared across the app. */

export type ThemeMode = 'light' | 'dark' | 'system';
export type Density = 'compact' | 'comfortable';
export type FontSize = 'small' | 'medium' | 'large';
export type SortMode = 'date-desc' | 'date-asc' | 'feed';

export interface Preferences {
  theme: ThemeMode;
  density: Density;
  fontSize: FontSize;
  /** Play YouTube videos inline in the reader (otherwise link out). */
  embedYouTube: boolean;
  /** Hide articles already marked as read. */
  hideRead: boolean;
  /** Sidebar collapsed to a hidden state on desktop (persists across sessions). */
  sidebarCollapsed: boolean;
  /**
   * YouTube Data API v3 key (optional). When set, channel/playlist feeds
   * (youtube.com/feeds/videos.xml) fetch up to 50 recent videos through the
   * API instead of the ~15-item cap on YouTube's own public RSS feed.
   * Stored locally only, sent to no one but Google's API.
   */
  youtubeApiKey: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  density: 'comfortable',
  fontSize: 'medium',
  embedYouTube: true,
  hideRead: false,
  sidebarCollapsed: false,
  youtubeApiKey: '',
};

export interface Feed {
  id: string;
  /** URL the user subscribed to. */
  url: string;
  title: string;
  /** Site homepage, when the feed declares one. */
  siteUrl?: string;
  description?: string;
  iconUrl?: string;
  /** Folder/group from OPML import (or assigned when subscribing). */
  folder?: string;
  addedAt: number;
}

export interface Article {
  id: string;
  feedId: string;
  title: string;
  link?: string;
  /** Plain-text excerpt for list rows. */
  summary: string;
  /** Feed-provided HTML, relative URLs already resolved, sanitized on render. */
  contentHtml: string;
  author?: string;
  publishedAt: number;
  /** Best still image for the card (enclosure / media:content / first <img>). */
  thumbnail?: string;
  /** Detected YouTube video id, if the item references one. */
  youtubeId?: string;
}

export interface FeedState {
  status: 'idle' | 'loading' | 'ok' | 'error';
  message?: string;
  updatedAt?: number;
  articleCount: number;
}

export interface UiState {
  activeFeedId: string | null;
  activeArticleId: string | null;
  sort: SortMode;
  query: string;
  sidebarOpen: boolean;
}

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

export interface AppState {
  feeds: Feed[];
  articles: Record<string, Article[]>;
  feedState: Record<string, FeedState>;
  readIds: Record<string, true>;
  prefs: Preferences;
  ui: UiState;
  toasts: Toast[];
  hydrated: boolean;
}

/** Sentinel feed id for the "all articles" view. */
export const ALL_FEEDS = '__all__';

/**
 * `activeFeedId` doubles as a folder-view id, prefixed so it can never
 * collide with a real feed id (those come from `feedIdForUrl`'s hash, never
 * containing a colon). Lets every existing consumer of `activeFeedId`
 * (selectArticles, keyboard nav, mark-all-read, ...) keep working unchanged;
 * only `selectArticles` needs to know what the prefix means.
 */
const FOLDER_PREFIX = 'folder:';

export function folderViewId(folderName: string): string {
  return FOLDER_PREFIX + folderName;
}

export function folderNameFromViewId(id: string | null): string | null {
  return id?.startsWith(FOLDER_PREFIX) ? id.slice(FOLDER_PREFIX.length) : null;
}
