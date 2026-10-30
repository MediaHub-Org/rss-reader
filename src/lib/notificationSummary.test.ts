import { describe, expect, it } from 'vitest';
import { summarizeNotifications } from './notificationSummary';

describe('summarizeNotifications', () => {
  it('returns null when there is nothing to report', () => {
    expect(summarizeNotifications([])).toBeNull();
    expect(summarizeNotifications([{ feed: 'A', count: 0 }])).toBeNull();
    expect(summarizeNotifications([{ feed: '  ', count: 2 }])).toBeNull();
  });

  it('uses a feed-specific title for one feed', () => {
    expect(summarizeNotifications([{ feed: 'BBC News', count: 3 }])).toEqual({
      title: 'New articles in BBC News',
      body: '3 new articles',
    });
    expect(summarizeNotifications([{ feed: 'BBC News', count: 1 }])?.body).toBe(
      '1 new article'
    );
  });

  it('groups multiple feeds into one notification', () => {
    const summary = summarizeNotifications([
      { feed: 'BBC', count: 2 },
      { feed: 'The Verge', count: 3 },
    ]);
    expect(summary?.title).toBe('5 new articles');
    expect(summary?.body).toBe('Across 2 feeds: BBC (2), The Verge (3)');
  });

  it('caps the feed names after three', () => {
    const summary = summarizeNotifications([
      { feed: 'A', count: 1 },
      { feed: 'B', count: 1 },
      { feed: 'C', count: 1 },
      { feed: 'D', count: 1 },
    ]);
    expect(summary?.body).toBe('Across 4 feeds: A (1), B (1), C (1) +1 more');
  });
});
