import { describe, expect, it } from 'vitest';
import { mapRedditPosts, subredditFromUrl } from './reddit';

describe('subredditFromUrl', () => {
  it('extracts subreddits from regular and RSS URLs', () => {
    expect(subredditFromUrl('https://www.reddit.com/r/linux')).toBe('linux');
    expect(subredditFromUrl('https://old.reddit.com/r/selfhosted/.rss')).toBe('selfhosted');
    expect(subredditFromUrl('https://reddit.com/r/archlinux/')).toBe('archlinux');
  });

  it('ignores non-subreddit Reddit URLs', () => {
    expect(subredditFromUrl('https://www.reddit.com/user/someone')).toBeNull();
    expect(subredditFromUrl('https://example.com/r/linux')).toBeNull();
  });
});

describe('mapRedditPosts', () => {
  it('maps posts, external links and preview images', () => {
    const result = mapRedditPosts(
      'linux',
      [
        {
          id: 'abc',
          title: 'A post',
          selftext_html: '&lt;p&gt;Hello &amp; welcome&lt;/p&gt;',
          url: 'https://example.com/article',
          author: 'alice',
          created_utc: 1_700_000_000,
          preview: { images: [{ source: { url: 'https://i.redd.it/a.jpg?width=640&amp;height=480' } }] },
        },
      ],
      'feed-1'
    );
    const article = result.articles[0];
    expect(result.feed.title).toBe('r/linux');
    expect(article.title).toBe('A post');
    expect(article.link).toBe('https://example.com/article');
    expect(article.author).toBe('alice');
    expect(article.contentHtml).toContain('Hello & welcome');
    expect(article.thumbnail).toContain('width=640&height=480');
    expect(article.id.startsWith('feed-1-')).toBe(true);
  });

  it('uses the Reddit permalink for self posts and sorts newest first', () => {
    const result = mapRedditPosts(
      'linux',
      [
        { id: 'old', title: 'Old', permalink: '/r/linux/comments/old', created_utc: 1 },
        { id: 'new', title: 'New', permalink: '/r/linux/comments/new', created_utc: 2 },
      ],
      'f'
    );
    expect(result.articles.map((article) => article.title)).toEqual(['New', 'Old']);
    expect(result.articles[0].link).toBe('https://www.reddit.com/r/linux/comments/new');
  });
});
