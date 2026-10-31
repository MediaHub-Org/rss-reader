import type { Article, Feed } from '../types';
import { articleId } from './hash';
import { toExcerpt, toPlainText, type ParseResult } from './feedParser';
import { cleanTitle } from './format';

/**
 * Telegram channels have no native RSS. The public `/s/<channel>` preview page
 * contains the same posts an RSS feed would, so normalize those messages into
 * articles for subscribed `t.me/<channel>` sources.
 */
export function telegramChannelFromUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== 't.me' && host !== 'telegram.me' && host !== 'telegram.dog') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 's') parts.shift();
  if (parts.length !== 1) return null;
  const channel = parts[0];
  if (!/^[A-Za-z0-9_]{4,}$/.test(channel)) return null;
  return channel;
}

function decodeBackgroundImage(style: string | null): string | undefined {
  if (!style) return undefined;
  const match = /url\((['"]?)(.*?)\1\)/i.exec(style);
  return match?.[2]?.replace(/&amp;/g, '&');
}

function messageTitle(text: string): string {
  const line = text.split('\n').map((part) => part.trim()).find(Boolean);
  if (!line) return 'Telegram post';
  return cleanTitle(line.length > 140 ? `${line.slice(0, 139)}…` : line);
}

/** Normalize a Telegram public preview page into the app's ParseResult. */
export function parseTelegramChannel(
  html: string,
  channel: string,
  feedId: string
): ParseResult {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const channelTitle =
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ??
    doc.querySelector('.tgme_channel_info_header_title')?.textContent ??
    `@${channel}`;
  const articles: Article[] = [];

  for (const node of doc.querySelectorAll<HTMLElement>('.tgme_widget_message[data-post]')) {
    const dataPost = node.getAttribute('data-post');
    if (!dataPost) continue;
    const textNode = node.querySelector<HTMLElement>('.tgme_widget_message_text');
    const text = (textNode?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const time = node.querySelector('time[datetime]')?.getAttribute('datetime');
    const parsedTime = time ? Date.parse(time) : Date.now();
    const publishedAt = Number.isNaN(parsedTime) ? Date.now() : parsedTime;
    const link = `https://t.me/${dataPost}`;
    const image =
      decodeBackgroundImage(
        node.querySelector<HTMLElement>('.tgme_widget_message_photo_wrap')?.getAttribute('style') ??
          null
      ) ??
      decodeBackgroundImage(
        node.querySelector<HTMLElement>('.tgme_widget_message_video_thumb')?.getAttribute('style') ??
          null
      );
    const htmlBody = textNode?.innerHTML ?? '';
    const contentHtml = image
      ? `${htmlBody}<figure><img src="${image}" alt="" loading="lazy"></figure>`
      : htmlBody;
    const title = messageTitle(text);

    articles.push({
      id: articleId(feedId, { guid: `telegram-${dataPost}`, link, title, publishedAt }),
      feedId,
      title,
      link,
      summary: toExcerpt(contentHtml || title),
      contentHtml,
      searchText: `${title}\n${toPlainText(contentHtml)}`.toLowerCase(),
      publishedAt,
      thumbnail: image,
    });
  }

  articles.sort((a, b) => b.publishedAt - a.publishedAt);
  const feed: Omit<Feed, 'id' | 'addedAt'> = {
    url: `https://t.me/${channel}`,
    title: cleanTitle(channelTitle),
    siteUrl: `https://t.me/${channel}`,
    description: 'Telegram channel',
  };
  return { feed, articles };
}
