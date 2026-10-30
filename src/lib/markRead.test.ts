import { describe, expect, it } from 'vitest';
import type { Article } from '../types';
import { articlesToMarkRead } from './markRead';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const article = (id: string, ageDays: number): Article => ({
  id,
  feedId: 'f1',
  title: id,
  summary: '',
  contentHtml: '',
  publishedAt: NOW - ageDays * DAY,
});

describe('articlesToMarkRead', () => {
  const articles = [article('today', 0), article('one', 1), article('three', 3), article('seven', 7), article('old', 10)];

  it('marks only unread articles', () => {
    expect(articlesToMarkRead(articles, { one: true }, 0, NOW)).toEqual([
      'today',
      'three',
      'seven',
      'old',
    ]);
  });

  it('uses strict older-than cutoffs', () => {
    expect(articlesToMarkRead(articles, {}, 1, NOW)).toEqual(['three', 'seven', 'old']);
    expect(articlesToMarkRead(articles, {}, 3, NOW)).toEqual(['seven', 'old']);
    expect(articlesToMarkRead(articles, {}, 7, NOW)).toEqual(['old']);
  });

  it('returns nothing when everything is read', () => {
    expect(
      articlesToMarkRead(
        articles,
        { today: true, one: true, three: true, seven: true, old: true },
        0,
        NOW
      )
    ).toEqual([]);
  });
});
