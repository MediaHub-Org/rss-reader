import { describe, expect, it } from 'vitest';
import { detectEmbed } from './embeds';

describe('detectEmbed', () => {
  it('keeps the existing media providers', () => {
    expect(detectEmbed('https://www.youtube.com/watch?v=kJQP7kiw5Fk')?.provider).toBe('youtube');
    expect(detectEmbed('https://vimeo.com/76979871')?.provider).toBe('vimeo');
    expect(detectEmbed('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')?.provider).toBe(
      'spotify'
    );
  });

  it('detects Reddit posts', () => {
    const embed = detectEmbed('https://www.reddit.com/r/linux/comments/1abc123/a_post/');
    expect(embed?.provider).toBe('reddit');
    expect(embed?.layout).toBe('social');
    expect(embed?.src).toBe(
      'https://www.reddit.com/r/linux/comments/1abc123/a_post/?embed=true'
    );
  });

  it('detects Telegram posts and channels', () => {
    expect(detectEmbed('https://t.me/durov/123')?.src).toBe(
      'https://t.me/durov/123?embed=1&discussion=1'
    );
    expect(detectEmbed('https://t.me/durov')?.src).toBe('https://t.me/durov?embed=1');
  });

  it('detects TikTok, Instagram and Threads posts', () => {
    expect(
      detectEmbed('https://www.tiktok.com/@scout2015/video/6718335390845095173')?.provider
    ).toBe('tiktok');
    expect(detectEmbed('https://www.instagram.com/p/CxYzAbC123/')?.provider).toBe('instagram');
    expect(detectEmbed('https://www.threads.net/@user/post/CxYzAbC123')?.provider).toBe('threads');
  });

  it('detects X posts and Mastodon posts on known instances', () => {
    expect(detectEmbed('https://x.com/user/status/1234567890')?.provider).toBe('x');
    expect(detectEmbed('https://mastodon.social/@user/1234567890')?.provider).toBe('mastodon');
    expect(detectEmbed('https://example.com/@user/1234567890')).toBeNull();
  });
});
