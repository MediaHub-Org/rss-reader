// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

import { proxyFeedRequest, validateFeedUrl } from './proxy-lib.mjs';

const blocked = [
  'http://127.0.0.1/feed.xml',
  'http://10.1.2.3/feed.xml',
  'http://172.20.0.1/feed.xml',
  'http://192.168.1.10/feed.xml',
  'http://169.254.1.1/feed.xml',
  'http://100.64.0.1/feed.xml',
  'http://198.18.0.1/feed.xml',
  'http://0.0.0.0/feed.xml',
  'http://[::1]/feed.xml',
  'http://[::ffff:127.0.0.1]/feed.xml',
  'http://[0:0:0:0:0:ffff:7f00:1]/feed.xml',
  'http://[fe80::1]/feed.xml',
  'http://[fc00::1]/feed.xml',
  'http://[2002:7f00:1::]/feed.xml',
  'http://[2001:0:1::]/feed.xml',
  'http://printer.local/feed.xml',
  'http://intranet.internal/feed.xml',
];

describe('validateFeedUrl (SSRF guard)', () => {
  it.each(blocked)('refuses %s', (url) => {
    const result = validateFeedUrl(url);
    expect(result.ok).toBe(false);
  });

  it('accepts public IPv4, IPv6 and hostnames', () => {
    for (const url of [
      'https://example.com/feed.xml',
      'http://feeds.bbci.co.uk/news/rss.xml',
      'https://[2606:4700:4700::1111]/feed.xml',
    ]) {
      expect(validateFeedUrl(url).ok, url).toBe(true);
    }
  });

  it('still rejects non-http schemes', () => {
    expect(validateFeedUrl('ftp://example.com/feed.xml').ok).toBe(false);
    expect(validateFeedUrl('file:///etc/passwd').ok).toBe(false);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('proxyFeedRequest redirects', () => {
  it('follows a public redirect', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://cdn.example.org/feed.xml' } })
      )
      .mockResolvedValueOnce(
        new Response('<rss/>', {
          status: 200,
          headers: { 'content-type': 'application/rss+xml' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await proxyFeedRequest('https://example.com/feed.xml');

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses a redirect into loopback without fetching it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8080/admin' } })
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await proxyFeedRequest('https://example.com/feed.xml');

    expect(result.status).toBe(502);
    expect(result.body).toMatch(/not reachable/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect to an internal name', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(null, {
          status: 301,
          headers: { location: 'https://metadata.example.internal/secret' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await proxyFeedRequest('https://example.com/feed.xml');

    expect(result.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
