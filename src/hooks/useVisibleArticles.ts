import { useMemo } from 'react';
import type { AppState, Article } from '../types';
import { selectArticles } from '../store/store';

/**
 * The filtered, sorted list currently visible in the reading pane. Every
 * consumer used to repeat the same option object; keeping it here means a new
 * filter or search option only has to be added once.
 */
export function useVisibleArticles(state: AppState): Article[] {
  return useMemo(
    () =>
      selectArticles(state, {
        feedId: state.ui.activeFeedId,
        sort: state.ui.sort,
        query: state.ui.query,
        filter: state.prefs.articleFilter,
        caseSensitive: state.prefs.searchCaseSensitive,
        fullText: state.prefs.searchFullText,
        regex: state.prefs.searchRegex,
        searchAll: state.ui.searchAllFeeds,
      }),
    [state]
  );
}
