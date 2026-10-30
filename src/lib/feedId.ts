/**
 * Feed identity rules for imports.
 *
 * Normally an id is derived from the URL. Discovery/redirects can change the
 * stored URL without changing the id (see `trackAlternate`), and full backups
 * carry the original id. Resolve all of that in one place so OPML and JSON
 * imports cannot disagree.
 */
import { feedIdForUrl } from './feedParser';

const FEED_ID = /^f[a-z0-9]+$/i;

export function isFeedId(value: string | undefined): value is string {
  return Boolean(value && FEED_ID.test(value));
}

export function resolveImportedFeedId(
  candidateId: string | undefined,
  url: string,
  existingById: ReadonlyMap<string, { id: string; url: string }>,
  existingByUrl: ReadonlyMap<string, { id: string; url: string }>
): string {
  let id = isFeedId(candidateId) ? candidateId : feedIdForUrl(url);
  const collision = existingById.get(id);

  if (collision && collision.url !== url) {
    // The carried id belongs to a different URL on this device; prefer the
    // feed that already owns this URL, then fall back to the hash.
    id = existingByUrl.get(url)?.id ?? feedIdForUrl(url);
  } else if (!collision) {
    const urlMatch = existingByUrl.get(url);
    if (urlMatch) id = urlMatch.id;
  }

  return id;
}
