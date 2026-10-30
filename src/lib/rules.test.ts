import { describe, expect, it } from 'vitest';
import type { Article, ArticleRule, Feed } from '../types';
import { applyRulesToArticles, parseRule, ruleMatchesArticle } from './rules';

const feed = (id: string, folder?: string): Feed => ({
  id,
  url: `https://example.com/${id}.xml`,
  title: id,
  folder,
  addedAt: 1,
});

const article = (id: string, feedId: string, title: string, body = ''): Article => ({
  id,
  feedId,
  title,
  summary: '',
  contentHtml: body,
  publishedAt: 1,
});

const rule = (patch: Partial<ArticleRule> = {}): ArticleRule => ({
  id: 'r1',
  enabled: true,
  pattern: 'bitcoin',
  field: 'title',
  mode: 'contains',
  negate: false,
  actions: ['read'],
  scope: 'all',
  ...patch,
});

describe('ruleMatchesArticle', () => {
  const feeds = [feed('f1', 'Tech'), feed('f2', 'News')];

  it('matches case-insensitively by substring', () => {
    const a = article('a1', 'f1', 'Why Bitcoin matters');
    expect(ruleMatchesArticle(a, rule(), feeds)).toBe(true);
    expect(ruleMatchesArticle(a, rule({ pattern: 'ethereum' }), feeds)).toBe(false);
  });

  it('can search the body and negate', () => {
    const a = article('a1', 'f1', 'Markets', '<p>The BTC price rose</p>');
    expect(ruleMatchesArticle(a, rule({ pattern: 'btc' }), feeds)).toBe(false);
    expect(ruleMatchesArticle(a, rule({ field: 'content', pattern: 'btc' }), feeds)).toBe(true);
    expect(
      ruleMatchesArticle(a, rule({ field: 'content', pattern: 'btc', negate: true }), feeds)
    ).toBe(false);
  });

  it('supports regular expressions and ignores invalid ones', () => {
    const a = article('a1', 'f1', 'Episode 42: release');
    expect(ruleMatchesArticle(a, rule({ mode: 'regex', pattern: 'episode \\d+' }), feeds)).toBe(true);
    expect(ruleMatchesArticle(a, rule({ mode: 'regex', pattern: '(' }), feeds)).toBe(false);
  });

  it('honours feed and group scopes', () => {
    const a = article('a1', 'f1', 'Bitcoin');
    expect(ruleMatchesArticle(a, rule({ scope: 'feed:f1' }), feeds)).toBe(true);
    expect(ruleMatchesArticle(a, rule({ scope: 'feed:f2' }), feeds)).toBe(false);
    expect(ruleMatchesArticle(a, rule({ scope: 'group:Tech' }), feeds)).toBe(true);
    expect(ruleMatchesArticle(a, rule({ scope: 'group:News' }), feeds)).toBe(false);
  });

  it('ignores disabled rules and empty patterns', () => {
    const a = article('a1', 'f1', 'Bitcoin');
    expect(ruleMatchesArticle(a, rule({ enabled: false }), feeds)).toBe(false);
    expect(ruleMatchesArticle(a, rule({ pattern: '   ' }), feeds)).toBe(false);
  });
});

describe('applyRulesToArticles', () => {
  it('cascades actions from several matching rules', () => {
    const articles = [article('a1', 'f1', 'Bitcoin news'), article('a2', 'f1', 'Sports')];
    const result = applyRulesToArticles(
      articles,
      [
        rule({ id: 'r1', pattern: 'bitcoin', actions: ['read'] }),
        rule({ id: 'r2', pattern: 'news', actions: ['star'] }),
        rule({ id: 'r3', pattern: 'sports', actions: ['star', 'read'] }),
      ],
      [feed('f1')]
    );
    expect(result.readIds.sort()).toEqual(['a1', 'a2']);
    expect(result.starredIds.sort()).toEqual(['a1', 'a2']);
  });

  it('does nothing without enabled rules', () => {
    expect(applyRulesToArticles([article('a1', 'f1', 'Bitcoin')], [], [feed('f1')])).toEqual({
      readIds: [],
      starredIds: [],
    });
  });
});

describe('parseRule', () => {
  it('rejects rules that cannot do anything', () => {
    expect(parseRule(null)).toBeNull();
    expect(parseRule({ pattern: '', actions: ['read'] })).toBeNull();
    expect(parseRule({ pattern: 'x', actions: [] })).toBeNull();
  });

  it('sanitises imported data', () => {
    const parsed = parseRule({
      id: 'custom',
      pattern: 'hello',
      field: 'body',
      mode: 'glob',
      negate: 'yes',
      actions: ['read', 'read', 'hide'],
      scope: 'group:Tech',
      enabled: false,
    });
    expect(parsed).toMatchObject({
      id: 'custom',
      pattern: 'hello',
      field: 'title',
      mode: 'contains',
      negate: false,
      actions: ['read'],
      scope: 'group:Tech',
      enabled: false,
    });
  });
});
