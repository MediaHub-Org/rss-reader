/** Domain types shared across the app. */

export type ThemeMode = 'light' | 'dark' | 'system';
export type Density = 'compact' | 'comfortable';
export type FontSize = 'small' | 'medium' | 'large';
export type SortMode = 'date-desc' | 'date-asc' | 'feed';

export interface Preferences {
  theme: ThemeMode;
  density: Density;
  fontSize: FontSize;
  /** Embed YouTube players inline instead of linking out. */
  embedYouTube: boolean;
  /** Hide articles already marked as read. */
  hideRead: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  density: 'comfortable',
  fontSize: 'medium',
  embedYouTube: false,
  hideRead: false,
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
