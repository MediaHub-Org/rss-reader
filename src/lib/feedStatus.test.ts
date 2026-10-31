import { describe, expect, it } from 'vitest';
import { lastUpdatedAt } from './feedStatus';
import type { FeedState } from '../types';

const state = (updatedAt?: number): FeedState => ({
  status: 'ok',
  articleCount: 0,
  updatedAt,
});

describe('lastUpdatedAt', () => {
  it('returns the newest successful refresh', () => {
    expect(lastUpdatedAt({ a: state(100), b: state(250), c: state(175) })).toBe(250);
  });

  it('ignores feeds without a timestamp', () => {
    expect(lastUpdatedAt({})).toBe(0);
    expect(lastUpdatedAt({ a: state(undefined), b: { ...state(50), status: 'error' } })).toBe(50);
  });
});
