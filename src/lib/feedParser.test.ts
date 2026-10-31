import { describe, expect, it } from 'vitest';
import {
  FeedParseError,
  looksLikeFeed,
  parseFeedXml,
  pickDate,
  toExcerpt,
  toPlainText,
} from './feedParser';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Example Feed</title>
    <link>https://example.com</link>
    <description>An example</description>
    <item>
      <title>Hello &amp; world</title>
      <link>/posts/1</link>
      <guid isPermaLink="false">post-1</guid>
      <pubDate>Wed, 21 Oct 2026 09:00:00 GMT</pubDate>
      <description><![CDATA[<p>Body <strong>text</strong></p><img src="/img.jpg">]]></description>
      <enclosure url="https://example.com/audio.mp3" type="audio/mpeg" />
      <dc:creator>Alice</dc:creator>
    </item>
    <item>
      <title>Media item</title>
      <link>https://example.com/posts/2</link>
      <media:content url="https://cdn.example.com/photo.jpg" />
      <pubDate>Wed, 21 Oct 2026 08:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

describe('parseFeedXml', () => {
  it('normalizes an RSS feed, resolving relative links and images', async () => {
    const { feed, articles } = await parseFeedXml(RSS, 'feed-1');

    expect(feed.title).toBe('Example Feed');
    expect(feed.siteUrl).toBe('https://example.com');
    expect(articles).toHaveLength(2);

    const first = articles.find((entry) => entry.title === 'Hello & world');
    expect(first).toMatchObject({
      feedId: 'feed-1',
      link: 'https://example.com/posts/1',
      author: 'Alice',
      thumbnail: 'https://example.com/img.jpg',
      audioUrl: 'https://example.com/audio.mp3',
    });
    expect(first?.summary).toContain('Body text');
    expect(first?.searchText).toContain('hello & world');

    const media = articles.find((entry) => entry.title === 'Media item');
    expect(media?.thumbnail).toBe('https://cdn.example.com/photo.jpg');
  });

  it('normalizes Atom entries', async () => {
    const atom = `<?xml version="1.0" encoding="utf-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Atom Feed</title>
        <link href="https://atom.example/" />
        <entry>
          <title>Entry one</title>
          <link href="https://atom.example/entry-1" />
          <id>tag:atom.example,2026:1</id>
          <updated>2026-10-21T09:00:00Z</updated>
          <author><name>Bob</name></author>
          <content type="html">&lt;p&gt;Atom body&lt;/p&gt;</content>
        </entry>
      </feed>`;

    const { feed, articles } = await parseFeedXml(atom, 'feed-2');
    expect(feed.title).toBe('Atom Feed');
    expect(feed.siteUrl).toBe('https://atom.example/');
    expect(articles[0]).toMatchObject({
      title: 'Entry one',
      link: 'https://atom.example/entry-1',
      author: 'Bob',
    });
    expect(articles[0].contentHtml).toContain('Atom body');
  });

  it('rejects malformed XML', async () => {
    await expect(parseFeedXml('<rss><channel>', 'feed-3')).rejects.toBeInstanceOf(
      FeedParseError
    );
  });
});

describe('feed text helpers', () => {
  it('strips markup, scripts and common entities', () => {
    expect(toPlainText('<p>Hello &amp; <strong>world</strong></p><script>x</script>')).toBe(
      'Hello & world'
    );
  });

  it('truncates excerpts with an ellipsis', () => {
    expect(toExcerpt('<p>abcdefghij</p>', 7)).toBe('abcdef…');
  });

  it('accepts seconds, milliseconds and date strings', () => {
    expect(pickDate(1_700_000_000)).toBe(1_700_000_000_000);
    expect(pickDate(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(pickDate('2026-10-21T09:00:00Z')).toBe(Date.parse('2026-10-21T09:00:00Z'));
    expect(pickDate('not a date')).toBeGreaterThan(0);
  });

  it('detects feed-looking documents', () => {
    expect(looksLikeFeed('<rss version="2.0"></rss>')).toBe(true);
    expect(looksLikeFeed('<feed xmlns="http://www.w3.org/2005/Atom"></feed>')).toBe(true);
    expect(looksLikeFeed('<html><body>No</body></html>')).toBe(false);
    expect(looksLikeFeed('')).toBe(false);
  });
});
