import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFeedArticles, fetchFeedDocument } from './fetchFeed';

const url = 'https://example.com/feed.xml';
const xml = '<rss version="2.0"><channel><title>Test feed</title></channel></rss>';
const validators = { etag: '"revision-1"', lastModified: 'Fri, 13 Nov 2026 10:00:00 GMT' };

afterEach(() => vi.unstubAllGlobals());

describe('browser feed cache validation', () => {
  it('saves origin validators for subsequent refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(xml, {
      headers: { ETag: validators.etag, 'Last-Modified': validators.lastModified },
    }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchFeedDocument(url)).toMatchObject({ xml, ...validators });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('If-None-Match');
  });

  it('keeps cached articles on a 304 without parsing or retrying through proxies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchFeedArticles(url, 'feed-1', undefined, validators)).toMatchObject({
      notModified: true, finalUrl: url, ...validators,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      'If-None-Match': validators.etag,
      'If-Modified-Since': validators.lastModified,
    });
  });

  it('accepts updated validators returned with a 304', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, {
      status: 304, headers: { ETag: '"revision-2"' },
    })));
    expect(await fetchFeedDocument(url, validators)).toMatchObject({
      notModified: true, etag: '"revision-2"', lastModified: validators.lastModified,
    });
  });

  it('falls back after a CORS rejection without passing origin validators to proxies', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(xml, { headers: { ETag: '"proxy-cache"' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchFeedDocument(url, validators);
    expect(result).toMatchObject({ xml, via: 'local-proxy' });
    expect(result.etag).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers).toEqual({
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
    });
  });
});
