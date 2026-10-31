import { describe, expect, it } from 'vitest';
import type { Article } from '../types';
import { articleMatches, searchableText } from './search';

const article = (overrides: Partial<Article> = {}): Article => ({
  id: 'a1',
  feedId: 'f1',
  title: 'Visible title',
  summary: 'Short summary',
  contentHtml:
    '<p>Body with a rareword and a <a href="https://example.com">link</a>.</p>',
  author: 'Author',
  publishedAt: 1,
  ...overrides,
});

describe('articleMatches', () => {
  it('matches title, summary, author and article body', () => {
    const a = article();
    expect(articleMatches(a, 'visible')).toBe(true);
    expect(articleMatches(a, 'short')).toBe(true);
    expect(articleMatches(a, 'author')).toBe(true);
    expect(articleMatches(a, 'rareword')).toBe(true);
    expect(articleMatches(a, 'missing')).toBe(false);
  });

  it('is case-insensitive and treats an empty query as a match', () => {
    const a = article();
    expect(articleMatches(a, 'RAREWORD')).toBe(true);
    expect(articleMatches(a, '   ')).toBe(true);
  });

  it('uses a stored searchText when the article already has one', () => {
    const a = article({ searchText: 'precomputed needle', contentHtml: '<p>other</p>' });
    expect(articleMatches(a, 'needle')).toBe(true);
    expect(articleMatches(a, 'other')).toBe(false);
    expect(searchableText(a)).toBe('precomputed needle');
  });

  it('caches the fallback text per article object', () => {
    const a = article();
    expect(searchableText(a)).toBe(searchableText(a));
    expect(searchableText(a)).toContain('rareword');
  });
});

describe('search options', () => {
  const a = article({
    title: 'A normal title',
    summary: 'A summary without the marker',
    contentHtml: '<p>Body-only Special Token.</p>',
  });

  it('honours case sensitivity', () => {
    expect(articleMatches(a, 'special')).toBe(true);
    expect(articleMatches(a, 'special', { caseSensitive: true })).toBe(false);
    expect(articleMatches(a, 'Special', { caseSensitive: true })).toBe(true);
  });

  it('supports regular expressions and invalid patterns', () => {
    expect(articleMatches(a, 'Spec[a-z]+ Token', { regex: true })).toBe(true);
    expect(articleMatches(a, 'spec[a-z]+ token', { regex: true, caseSensitive: true })).toBe(false);
    expect(articleMatches(a, '(', { regex: true })).toBe(false);
  });

  it('can restrict matching to title/summary/author', () => {
    expect(articleMatches(a, 'Special', { fullText: false })).toBe(false);
    expect(articleMatches(a, 'normal', { fullText: false })).toBe(true);
    expect(articleMatches(a, 'Special', { fullText: true })).toBe(true);
  });
});
