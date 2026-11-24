// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateFeedUrl } from './proxy-lib.mjs';

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
