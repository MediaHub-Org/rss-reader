import { useMemo } from 'react';
import type { AppState, Article } from '../types';
import { selectArticles } from '../store/store';

/**
 * The filtered, sorted list currently visible in the reading pane. Every
 * consumer used to repeat the same option object; keeping it here means a new
 * filter or search option only has to be added once.
 */
export function useVisibleArticles(state: AppState): Article[] {
  const { articles, feeds, readIds, starredIds, ui, prefs } = state;
  return useMemo(
    () =>
      selectArticles(state, {
        feedId: ui.activeFeedId,
        sort: ui.sort,
        query: ui.query,
        filter: prefs.articleFilter,
        caseSensitive: prefs.searchCaseSensitive,
        fullText: prefs.searchFullText,
        regex: prefs.searchRegex,
        searchAll: ui.searchAllFeeds,
      }),
    // Only rebuild the list when something that feeds selectArticles changes.
    // Toasts, feed status and other state updates no longer re-sort thousands
    // of articles on every notification.
    [
      articles,
      feeds,
      readIds,
      starredIds,
      ui.activeFeedId,
      ui.sort,
      ui.query,
      ui.searchAllFeeds,
      prefs.articleFilter,
      prefs.searchCaseSensitive,
      prefs.searchFullText,
      prefs.searchRegex,
    ]
  );
}
