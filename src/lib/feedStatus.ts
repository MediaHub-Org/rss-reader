import type { FeedState } from '../types';

/**
 * Newest successful refresh across the subscribed feeds. Feed state is keyed by
 * feed id, so a single pass gives the whole library's freshness without
 * scanning articles.
 */
export function lastUpdatedAt(feedState: Record<string, FeedState>): number {
  let newest = 0;
  for (const feed of Object.values(feedState)) {
    if (feed.updatedAt && feed.updatedAt > newest) newest = feed.updatedAt;
  }
  return newest;
}
