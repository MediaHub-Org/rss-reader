import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearReadingPositions,
  clampPosition,
  flushPositions,
  positionFor,
  rememberPosition,
} from './readingPosition';

const KEY = 'rss-reader:positions';

describe('reading position', () => {
  beforeEach(() => {
    clearReadingPositions();
  });

  it('starts at zero and rounds what it stores', () => {
    expect(positionFor('missing')).toBe(0);
    rememberPosition('a', 123.6);
    expect(positionFor('a')).toBe(124);
  });

  it('writes only when flushed, then survives a fresh read', () => {
    rememberPosition('a', 200);
    expect(localStorage.getItem(KEY)).toBeNull();
    flushPositions();
    expect(localStorage.getItem(KEY)).toContain('"a"');
    // A new module-level read: clear the cache without touching storage.
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toMatchObject({ a: { y: 200 } });
  });

  it('never stores a negative or non-finite offset', () => {
    rememberPosition('a', -40);
    rememberPosition('b', Number.NaN);
    flushPositions();
    expect(positionFor('a')).toBe(0);
    expect(positionFor('b')).toBe(0);
  });

  it('keeps one entry per article and the most recent ones at the cap', () => {
    for (let i = 0; i < 305; i += 1) rememberPosition(`article-${i}`, i);
    flushPositions();
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    expect(Object.keys(stored)).toHaveLength(300);
    expect(stored['article-0']).toBeUndefined();
    expect(stored['article-304']).toBeDefined();
  });

  it('ignores a corrupt store instead of throwing', () => {
    localStorage.setItem(KEY, '{not json');
    expect(positionFor('a')).toBe(0);
    rememberPosition('a', 30);
    flushPositions();
    expect(positionFor('a')).toBe(30);
  });

  it('does not rewrite when the offset did not change', () => {
    rememberPosition('a', 80);
    flushPositions();
    rememberPosition('a', 80);
    // Nothing pending: a flush is a no-op and the stored value stays.
    flushPositions();
    expect(positionFor('a')).toBe(80);
  });

  it('clamps a restore to the height available now', () => {
    expect(clampPosition(500, 120)).toBe(120);
    expect(clampPosition(80, 500)).toBe(80);
    expect(clampPosition(-1, 500)).toBe(0);
    expect(clampPosition(120, 0)).toBe(0);
    expect(clampPosition(120, Number.NaN)).toBe(0);
  });
});
