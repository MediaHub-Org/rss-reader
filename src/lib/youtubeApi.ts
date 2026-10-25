/**
 * YouTube Data API v3 path for channel/playlist feeds, used instead of the
 * plain RSS feed when the user has pasted an API key into Settings.
 *
 * Why: youtube.com/feeds/videos.xml caps itself at ~15 items server-side,
 * same for every reader -- not something a parser can work around. The
 * Data API's playlistItems.list returns up to 50 per call instead.
 *
 * Needs no extra lookup call for the common case: a channel's "uploads"
 * playlist id is always its channel id with the "UC" prefix swapped for
 * "UU" (a stable YouTube convention), so a channel_id feed goes straight
 * to playlistItems.list for 1 API unit. A playlist_id feed already *is*
 * a playlist id. Only the rare legacy ?user= feed needs a channels.list
 * lookup first to resolve a username to its uploads playlist.
 */
import { articleId } from './hash';
import { pickDate, toExcerpt } from './feedParser';
import { thumbnailUrl, watchUrl } from './youtube';
import type { Article } from '../types';
import type { ParseResult } from './feedParser';

const API_BASE = 'https://www.googleapis.com/youtube/v3';

export class YouTubeApiError extends Error {}

export type YouTubeFeedTarget =
  | { kind: 'channel'; id: string }
  | { kind: 'playlist'; id: string }
  | { kind: 'user'; id: string };

/** Recognize a youtube.com/feeds/videos.xml URL and pull out what it targets. */
export function extractYouTubeFeedTarget(feedUrl: string): YouTubeFeedTarget | null {
  let url: URL;
  try {
    url = new URL(feedUrl);
  } catch {
    return null;
  }
  if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return null;
  if (!/\/feeds\/videos\.xml\/?$/i.test(url.pathname)) return null;

  const channelId = url.searchParams.get('channel_id');
  if (channelId) return { kind: 'channel', id: channelId };
  const playlistId = url.searchParams.get('playlist_id');
  if (playlistId) return { kind: 'playlist', id: playlistId };
  const user = url.searchParams.get('user');
  if (user) return { kind: 'user', id: user };
  return null;
}

async function apiGet(path: string, params: Record<string, string>): Promise<any> {
  const query = new URLSearchParams(params);
  const response = await fetch(`${API_BASE}/${path}?${query}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const reason = body?.error?.message as string | undefined;
    throw new YouTubeApiError(
      reason ? `YouTube Data API: ${reason}` : `YouTube Data API error ${response.status}`
    );
  }
  return response.json();
}

async function resolveUploadsPlaylistId(target: YouTubeFeedTarget, apiKey: string): Promise<string> {
  if (target.kind === 'playlist') return target.id;
  if (target.kind === 'channel' && target.id.startsWith('UC')) {
    return `UU${target.id.slice(2)}`;
  }
  const data = await apiGet('channels', {
    part: 'contentDetails',
    key: apiKey,
    ...(target.kind === 'user' ? { forUsername: target.id } : { id: target.id }),
  });
  const uploads = data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new YouTubeApiError('Could not resolve this channel on the YouTube Data API.');
  return uploads;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Fetch up to 50 recent videos for a channel/playlist feed via the Data API. */
export async function fetchYouTubeChannelFeed(
  target: YouTubeFeedTarget,
  feedId: string,
  apiKey: string
): Promise<ParseResult> {
  const playlistId = await resolveUploadsPlaylistId(target, apiKey);
  const data = await apiGet('playlistItems', {
    part: 'snippet,contentDetails',
    playlistId,
    maxResults: '50',
    key: apiKey,
  });

  const rawItems: any[] = Array.isArray(data?.items) ? data.items : [];

  const articles: Article[] = rawItems
    .map((item): Article | null => {
      const snippet = item.snippet ?? {};
      const videoId: string | undefined = item.contentDetails?.videoId ?? snippet.resourceId?.videoId;
      if (!videoId) return null;

      const title: string = snippet.title || '(untitled)';
      const publishedAt = pickDate(item.contentDetails?.videoPublishedAt, snippet.publishedAt);
      const description = typeof snippet.description === 'string' ? snippet.description : '';
      const contentHtml = description ? `<p>${escapeHtml(description).replace(/\n/g, '<br>')}</p>` : '';

      return {
        id: articleId(feedId, { guid: videoId, title, publishedAt }),
        feedId,
        title,
        link: watchUrl(videoId),
        summary: toExcerpt(description || title),
        contentHtml,
        author: snippet.videoOwnerChannelTitle || snippet.channelTitle,
        publishedAt,
        thumbnail: thumbnailUrl(videoId),
        youtubeId: videoId,
      };
    })
    .filter((a): a is Article => a !== null);

  if (!articles.length) {
    throw new YouTubeApiError('The YouTube Data API returned no videos for this channel.');
  }

  const channelTitle: string | undefined = rawItems[0]?.snippet?.channelTitle;
  const channelId: string | undefined =
    rawItems[0]?.snippet?.channelId ?? (target.kind === 'channel' ? target.id : undefined);

  return {
    feed: {
      url: '',
      title: channelTitle || '',
      siteUrl: channelId ? `https://www.youtube.com/channel/${channelId}` : undefined,
      description: undefined,
      iconUrl: undefined,
    },
    articles,
  };
}
