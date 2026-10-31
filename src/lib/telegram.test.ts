import { describe, expect, it } from 'vitest';
import { parseTelegramChannel, telegramChannelFromUrl } from './telegram';

describe('telegramChannelFromUrl', () => {
  it('recognizes channels but not individual posts', () => {
    expect(telegramChannelFromUrl('https://t.me/durov')).toBe('durov');
    expect(telegramChannelFromUrl('https://t.me/s/durov')).toBe('durov');
    expect(telegramChannelFromUrl('https://telegram.me/durov')).toBe('durov');
    expect(telegramChannelFromUrl('https://t.me/durov/123')).toBeNull();
    expect(telegramChannelFromUrl('https://example.com/durov')).toBeNull();
  });
});

describe('parseTelegramChannel', () => {
  it('maps messages, dates, links and photos', () => {
    const html = `
      <html><head><meta property="og:title" content="Durov &quot;news&quot;"></head><body>
        <div class="tgme_widget_message" data-post="durov/531">
          <div class="tgme_widget_message_text">Hello <b>world</b></div>
          <a class="tgme_widget_message_photo_wrap" style="background-image:url('https://cdn.example/a.jpg?w=640&amp;h=480')"></a>
          <time datetime="2026-07-16T20:45:25+00:00"></time>
        </div>
        <div class="tgme_widget_message" data-post="durov/532">
          <div class="tgme_widget_message_text">Second post</div>
          <time datetime="2026-07-17T20:45:25+00:00"></time>
        </div>
      </body></html>`;
    const result = parseTelegramChannel(html, 'durov', 'feed-1');
    expect(result.feed.title).toBe('Durov "news"');
    expect(result.articles).toHaveLength(2);
    expect(result.articles[0].title).toBe('Second post');
    expect(result.articles[1].link).toBe('https://t.me/durov/531');
    expect(result.articles[1].contentHtml).toContain('Hello <b>world</b>');
    expect(result.articles[1].thumbnail).toContain('w=640&h=480');
  });
});
