import { describe, expect, it } from 'vitest';
import type { Article, Feed, Preferences } from '../../types';
import { DEFAULT_PREFERENCES } from '../../types';
import { exportOpml, parseOpml } from './opml';
import { exportFullBackup, parseJsonBackup } from './backup';
import {
  ImportError,
  collectFolderNames,
  normalizeImportUrl,
  sortImportedFeeds,
} from './types';

const feed = (overrides: Partial<Feed> = {}): Feed => ({
  id: 'f1',
  url: 'https://example.com/feed.xml',
  title: 'Example',
  addedAt: 1,
  ...overrides,
});

const article = (overrides: Partial<Article> = {}): Article => ({
  id: 'f1-a1',
  feedId: 'f1',
  title: 'Story',
  summary: 'Summary',
  contentHtml: '<p>Body</p>',
  publishedAt: 100,
  ...overrides,
});

describe('normalizeImportUrl', () => {
  it('promotes bare hosts to HTTPS', () => {
    expect(normalizeImportUrl('example.com/feed.xml')).toBe(
      'https://example.com/feed.xml'
    );
  });

  it('accepts http(s) and rejects other schemes', () => {
    expect(normalizeImportUrl('http://example.com/feed')).toBe('http://example.com/feed');
    expect(normalizeImportUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeImportUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeImportUrl('  ')).toBeNull();
  });
});

describe('folder helpers', () => {
  it('deduplicates explicit folders and feed folders, sorted A–Z', () => {
    expect(
      collectFolderNames(
        [{ folder: ' News ' }, { folder: '' }, { folder: 'Alpha' }],
        ['News', 'Empty', '  ']
      )
    ).toEqual(['Alpha', 'Empty', 'News']);
  });

  it('sorts foldered feeds first and then by name', () => {
    const sorted = sortImportedFeeds([
      { url: 'https://z.example/feed', title: 'Zeta' },
      { url: 'https://b.example/feed', title: 'Beta', folder: 'Tech' },
      { url: 'https://a.example/feed', title: 'Alpha', folder: 'Tech' },
    ]);
    expect(sorted.map((entry) => entry.title)).toEqual(['Alpha', 'Beta', 'Zeta']);
  });
});

describe('OPML', () => {
  it('round-trips folders, empty folders and escaped titles', () => {
    const feeds = [
      feed({ title: 'Alpha & <Feed>', folder: 'News' }),
      feed({ id: 'f2', url: 'https://beta.example/feed', title: 'Beta' }),
    ];
    const xml = exportOpml(feeds, ['Empty']);

    expect(xml).toContain('xmlUrl="https://example.com/feed.xml"');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('text="Empty"');

    const parsed = parseOpml(xml);
    expect(parsed.format).toBe('opml');
    expect(parsed.feeds.map((entry) => entry.title)).toEqual(['Alpha & <Feed>', 'Beta']);
    expect(parsed.folders).toEqual(['Empty', 'News']);
  });

  it('preserves nested folder paths', () => {
    const parsed = parseOpml(`<?xml version="1.0"?>
      <opml version="2.0"><body>
        <outline text="News"><outline text="Tech">
          <outline type="rss" text="Nested" xmlUrl="https://nested.example/feed"/>
        </outline></outline>
      </body></opml>`);

    expect(parsed.feeds).toHaveLength(1);
    expect(parsed.feeds[0].folder).toBe('News / Tech');
    expect(parsed.folders).toEqual(['News / Tech']);
  });

  it('warns and skips invalid URLs', () => {
    const parsed = parseOpml(`<?xml version="1.0"?>
      <opml version="2.0"><body>
        <outline type="rss" text="Bad" xmlUrl="javascript:alert(1)"/>
        <outline type="rss" text="Good" xmlUrl="https://good.example/feed"/>
      </body></opml>`);

    expect(parsed.feeds).toHaveLength(1);
    expect(parsed.warnings).toHaveLength(1);
  });

  it('rejects non-OPML XML', () => {
    expect(() => parseOpml('<not-opml />')).toThrow(ImportError);
  });
});

describe('full JSON backup', () => {
  const prefs: Preferences = {
    ...DEFAULT_PREFERENCES,
    theme: 'dark',
    sidebarWidth: 420,
    youtubeApiKey: 'secret-key',
  };
  const feeds = [
    feed({ title: 'Alpha', folder: 'News' }),
    feed({ id: 'f2', url: 'https://beta.example/feed', title: 'Beta' }),
  ];
  const articles = { f1: [article()] };

  it('exports articles/preferences but never the API key or schema version', () => {
    const raw = exportFullBackup(feeds, { 'f1-a1': true }, ['Empty'], prefs, articles);
    const data = JSON.parse(raw);

    expect(data.version).toBe(2);
    expect(data.articles.f1).toHaveLength(1);
    expect(data.preferences.youtubeApiKey).toBeUndefined();
    expect(data.preferences.prefsVersion).toBeUndefined();
    expect(data.preferences.theme).toBe('dark');
    expect(data.folders).toEqual(['Empty', 'News']);
  });

  it('parses a v2 backup and keeps feed/article ids aligned', () => {
    const raw = exportFullBackup(feeds, { 'f1-a1': true }, ['Empty'], prefs, articles);
    const parsed = parseJsonBackup(raw);

    expect(parsed.full).toBe(true);
    expect(parsed.feeds.find((entry) => entry.title === 'Alpha')?.id).toBe('f1');
    expect(parsed.articles?.f1[0].title).toBe('Story');
    expect(parsed.readIds).toEqual({ 'f1-a1': true });
    expect(parsed.preferences?.theme).toBe('dark');
  });

  it('still accepts the v1 backup shape', () => {
    const parsed = parseJsonBackup(
      JSON.stringify({
        app: 'rss-reader',
        version: 1,
        feeds: [{ url: 'https://v1.example/feed', title: 'V1' }],
        folders: [],
        readIds: ['old-1'],
      })
    );

    expect(parsed.full).toBeUndefined();
    expect(parsed.preferences).toBeUndefined();
    expect(parsed.articles).toBeUndefined();
    expect(parsed.readIds).toEqual({ 'old-1': true });
  });

  it('sanitizes preferences instead of trusting the file', () => {
    const parsed = parseJsonBackup(
      JSON.stringify({
        version: 2,
        feeds: [{ id: 'f1', url: 'https://example.com/feed', title: 'Example' }],
        folders: [],
        readIds: [],
        preferences: {
          theme: 'neon',
          sidebarWidth: 9999,
          embedMedia: 'yes',
          collapsedFolders: [' A ', 'A', 3],
          youtubeApiKey: 'secret',
        },
        articles: {},
      })
    );

    expect(parsed.preferences?.theme).toBeUndefined();
    expect(parsed.preferences?.sidebarWidth).toBe(480);
    expect(parsed.preferences?.embedMedia).toBeUndefined();
    expect(parsed.preferences?.collapsedFolders).toEqual(['A']);
    expect(parsed.preferences && 'youtubeApiKey' in parsed.preferences).toBe(false);
  });

  it('remaps articles and read state when a backup has an invalid feed id', () => {
    const parsed = parseJsonBackup(
      JSON.stringify({
        version: 2,
        feeds: [{ id: 'not-a-feed-id', url: 'https://remap.example/feed' }],
        folders: [],
        readIds: ['not-a-feed-id-a1'],
        articles: {
          'not-a-feed-id': [{ id: 'not-a-feed-id-a1', title: 'A', publishedAt: 1 }],
        },
      })
    );

    const newId = parsed.feeds[0].id!;
    expect(newId).not.toBe('not-a-feed-id');
    expect(parsed.articles?.[newId]?.[0].id).toBe(`${newId}-a1`);
    expect(parsed.readIds).toEqual({ [`${newId}-a1`]: true });
  });

  it('rejects non-backup JSON', () => {
    expect(() => parseJsonBackup('null')).toThrow(ImportError);
    expect(() => parseJsonBackup('{"nope":true}')).toThrow(ImportError);
  });
});
