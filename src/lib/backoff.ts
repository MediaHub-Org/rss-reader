/**
 * Automatic refresh backoff.
 *
 * A feed that fails is retried after 5 min, then 10, 20… capped at 6 hours.
 * Manual refresh (toolbar, context menu, `r`) ignores this and forces a fetch.
 */
export const RETRY_BASE_MS = 5 * 60_000;
export const RETRY_MAX_MS = 6 * 60 * 60_000;

export function retryDelayMs(failures: number): number {
  const attempt = Math.max(1, Math.min(Math.floor(failures), 12));
  return Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS);
}

export function isRetryDue(feed: { nextRetryAt?: number }, now = Date.now()): boolean {
  return !feed.nextRetryAt || feed.nextRetryAt <= now;
}
