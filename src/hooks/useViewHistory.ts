import { useEffect } from 'react';
import { ALL_FEEDS } from '../types';
import { startViewHistory, syncView } from '../lib/viewHistory';

/**
 * Mirrors the active view into the browser history so the mouse's back and
 * forward buttons (and the browser shortcuts/gestures) move through the reader
 * instead of leaving the page.
 */
export function useViewHistory(
  feedId: string | null,
  articleId: string | null
): void {
  useEffect(() => {
    startViewHistory();
  }, []);

  useEffect(() => {
    syncView(feedId ?? ALL_FEEDS, articleId);
  }, [feedId, articleId]);
}
