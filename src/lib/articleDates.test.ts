import { describe, expect, it } from 'vitest';
import type { Article } from '../types';
import { clampFutureDates } from './articleDates';

const article = (id: string, publishedAt: number): Article => ({
  id,
  feedId: 'f1',
  title: id,
  summary: '',
  contentHtml: '',
  publishedAt,
});

describe('clampFutureDates', () => {
  it('clamps only future items and returns the same array when clean', () => {
    const now = 1_800_000_000_000;
    const clean = [article('a', now - 1), article('b', now)];
    expect(clampFutureDates(clean, now)).toBe(clean);

    const dirty = [article('a', now - 1), article('b', now + 86_400_000)];
    const next = clampFutureDates(dirty, now);
    expect(next).not.toBe(dirty);
    expect(next[0]).toBe(dirty[0]);
    expect(next[1].publishedAt).toBe(now);
    expect(next[1].title).toBe('b');
  });
});
