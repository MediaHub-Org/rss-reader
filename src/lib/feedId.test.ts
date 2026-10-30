import { describe, expect, it } from 'vitest';
import { feedIdForUrl } from './feedParser';
import { isFeedId, resolveImportedFeedId } from './feedId';

const url = 'https://example.com/feed.xml';
const computed = feedIdForUrl(url);

const feed = (id: string, feedUrl: string) => ({ id, url: feedUrl });

describe('isFeedId', () => {
  it('accepts generated ids only', () => {
    expect(isFeedId(computed)).toBe(true);
    expect(isFeedId('f1')).toBe(true);
    expect(isFeedId('fABC123')).toBe(true);
    expect(isFeedId('rss-reader')).toBe(false);
    expect(isFeedId('f-1')).toBe(false);
    expect(isFeedId(undefined)).toBe(false);
  });
});

describe('resolveImportedFeedId', () => {
  it('keeps a valid id from a full backup', () => {
    expect(resolveImportedFeedId('fbackup1', url, new Map(), new Map())).toBe('fbackup1');
  });

  it('derives the id when the backup has none', () => {
    expect(resolveImportedFeedId(undefined, url, new Map(), new Map())).toBe(computed);
  });

  it('reuses the id of an existing feed with the same URL', () => {
    const existing = feed('fold', url);
    const byId = new Map([['fold', existing]]);
    const byUrl = new Map([[url, existing]]);
    expect(resolveImportedFeedId('fnew', url, byId, byUrl)).toBe('fold');
  });

  it('does not steal an id that belongs to a different URL', () => {
    const other = feed('fbackup1', 'https://other.example/feed');
    const byId = new Map([['fbackup1', other]]);
    expect(resolveImportedFeedId('fbackup1', url, byId, new Map())).toBe(computed);
  });

  it('prefers the URL match when the carried id collides', () => {
    const other = feed('fbackup1', 'https://other.example/feed');
    const urlMatch = feed('furl', url);
    const byId = new Map([['fbackup1', other]]);
    const byUrl = new Map([[url, urlMatch]]);
    expect(resolveImportedFeedId('fbackup1', url, byId, byUrl)).toBe('furl');
  });
});
