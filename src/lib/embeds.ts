/**
 * Inline media players.
 *
 * A lot of feed items are little more than a link to Spotify, Vimeo or
 * SoundCloud. Every provider below exposes a keyless embed URL, so the reader
 * can play the media in place instead of sending you to another tab.
 *
 * Detection is deliberately done at render time (not at parse time): cached
 * articles from before this module existed get players too, without waiting
 * for a refresh.
 */
import { embedUrl as youtubeEmbedUrl, extractYouTubeId, watchUrl } from './youtube';

export type EmbedProvider =
  | 'youtube'
  | 'vimeo'
  | 'spotify'
  | 'soundcloud'
  | 'deezer'
  | 'apple-podcasts'
  | 'apple-music'
  | 'reddit'
  | 'telegram'
  | 'tiktok'
  | 'instagram'
  | 'threads'
  | 'x'
  | 'mastodon';

export interface MediaEmbed {
  provider: EmbedProvider;
  /** Human name for the caption (“Spotify”, “Vimeo”…). */
  label: string;
  /** Provider-side id: video id, Spotify id, Deezer numeric id… */
  id: string;
  /** Ready-to-use iframe src. */
  src: string;
  /** Where to open the media natively. */
  href: string;
  /** `video` gets a 16:9 box, `audio`/`social` use a fixed pixel height. */
  layout: 'video' | 'audio' | 'social';
  /** Height in px for `audio` players. */
  height?: number;
  /** iframe `allow` attribute. */
  allow: string;
}

const VIDEO_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen';
const AUDIO_ALLOW = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';

const AUDIO_HEIGHT: Record<EmbedProvider, number> = {
  youtube: 0,
  vimeo: 0,
  spotify: 152,
  soundcloud: 166,
  deezer: 90,
  'apple-podcasts': 175,
  'apple-music': 175,
  reddit: 0,
  telegram: 0,
  tiktok: 0,
  instagram: 0,
  threads: 0,
  x: 0,
  mastodon: 0,
};

/** Spotify is taller for containers (album/playlist/show) than for one track. */
function spotifyHeight(kind: string): number {
  return kind === 'track' || kind === 'episode' ? 152 : 352;
}

/** Deezer’s one-line player for a track, a full widget for a collection. */
function deezerHeight(kind: string): number {
  return kind === 'track' ? 90 : 300;
}

/** Mastodon instances that expose the standard /embed endpoint. */
const MASTODON_HOSTS = new Set([
  'mastodon.social',
  'mastodon.online',
  'mstdn.social',
  'fosstodon.org',
  'hachyderm.io',
  'infosec.exchange',
  'techhub.social',
  'mas.to',
]);

/**
 * Turn a URL into an inline player, or null when the provider is unknown.
 * Only https/http URLs with a recognised host ever produce a player, and the
 * iframe src is rebuilt from the parsed parts — never copied from the input.
 */
export function detectEmbed(raw: string | null | undefined): MediaEmbed | null {
  if (!raw) return null;

  // YouTube has its own detector: watch/shorts/live/embed/youtu.be/music.
  const youtubeId = extractYouTubeId(raw);
  if (youtubeId) {
    return {
      provider: 'youtube',
      label: 'YouTube',
      id: youtubeId,
      src: youtubeEmbedUrl(youtubeId),
      href: watchUrl(youtubeId),
      layout: 'video',
      allow: VIDEO_ALLOW,
    };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname;

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = /(?:^|\/)(\d{5,})(?:\/|$)/.exec(path)?.[1];
    if (!id) return null;
    return {
      provider: 'vimeo',
      label: 'Vimeo',
      id,
      src: `https://player.vimeo.com/video/${id}`,
      href: `https://vimeo.com/${id}`,
      layout: 'video',
      allow: VIDEO_ALLOW,
    };
  }

  if (host === 'open.spotify.com') {
    const match = /^\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]{10,})/.exec(
      path
    );
    if (!match) return null;
    const [, kind, id] = match;
    return {
      provider: 'spotify',
      label: 'Spotify',
      id,
      src: `https://open.spotify.com/embed/${kind}/${id}`,
      href: `https://open.spotify.com/${kind}/${id}`,
      layout: 'audio',
      height: spotifyHeight(kind),
      allow: AUDIO_ALLOW,
    };
  }

  if (host === 'soundcloud.com' || host === 'm.soundcloud.com') {
    if (/^\/(?:player|oembed)/.test(path)) return null;
    const clean = `https://soundcloud.com${path}`;
    return {
      provider: 'soundcloud',
      label: 'SoundCloud',
      id: path,
      src:
        `https://w.soundcloud.com/player/?url=${encodeURIComponent(clean)}` +
        '&color=%23ff5500&auto_play=false&hide_related=true&show_comments=false' +
        '&show_user=true&show_reposts=false&visual=false',
      href: clean,
      layout: 'audio',
      height: AUDIO_HEIGHT.soundcloud,
      allow: AUDIO_ALLOW,
    };
  }

  if (host === 'deezer.com') {
    const match = /^\/(?:[a-z]{2}\/)?(track|album|playlist|episode)\/(\d+)/.exec(path);
    if (!match) return null;
    const [, kind, id] = match;
    return {
      provider: 'deezer',
      label: 'Deezer',
      id,
      src: `https://widget.deezer.com/widget/dark/${kind}/${id}`,
      href: `https://www.deezer.com/${kind}/${id}`,
      layout: 'audio',
      height: deezerHeight(kind),
      allow: AUDIO_ALLOW,
    };
  }

  if (host === 'podcasts.apple.com') {
    const showId = /\/id(\d+)/.exec(path)?.[1];
    if (!showId) return null;
    const episode = url.searchParams.get('i');
    return {
      provider: 'apple-podcasts',
      label: 'Apple Podcasts',
      id: showId,
      src: `https://embed.podcasts.apple.com${path}${episode ? `?i=${episode}` : ''}`,
      href: url.toString(),
      layout: 'audio',
      height: AUDIO_HEIGHT['apple-podcasts'],
      allow: AUDIO_ALLOW,
    };
  }

  if (host === 'music.apple.com') {
    const id = /\/[a-z]{2}\/(?:album|playlist|song|music-video)\/[^/]+\/(?:id)?(\d+)/.exec(path)?.[1];
    if (!id) return null;
    return {
      provider: 'apple-music',
      label: 'Apple Music',
      id,
      src: `https://embed.music.apple.com${path}`,
      href: url.toString(),
      layout: 'audio',
      height: AUDIO_HEIGHT['apple-music'],
      allow: AUDIO_ALLOW,
    };
  }

  if (host === 'reddit.com' || host === 'old.reddit.com' || host === 'redd.it') {
    const match = /^\/r\/([^/]+)\/comments\/([A-Za-z0-9]+)(?:\/([^/?#]+))?/.exec(path);
    if (!match) return null;
    const [, sub, id, slug] = match;
    const canonical = `https://www.reddit.com/r/${sub}/comments/${id}/${slug ? `${slug}/` : ''}`;
    return {
      provider: 'reddit',
      label: 'Reddit',
      id: `${sub}/${id}`,
      src: `${canonical}?embed=true`,
      href: canonical,
      layout: 'social',
      height: 520,
      allow: VIDEO_ALLOW,
    };
  }

  if (host === 't.me' || host === 'telegram.me') {
    const post = /^\/([A-Za-z0-9_]{4,})\/(\d+)/.exec(path);
    const channel = /^\/([A-Za-z0-9_]{4,})\/?$/.exec(path);
    if (!post && !channel) return null;
    if (post) {
      const [, name, id] = post;
      return {
        provider: 'telegram',
        label: 'Telegram',
        id: `${name}/${id}`,
        src: `https://t.me/${name}/${id}?embed=1&discussion=1`,
        href: `https://t.me/${name}/${id}`,
        layout: 'social',
        height: 480,
        allow: VIDEO_ALLOW,
      };
    }
    const [, name] = channel!;
    return {
      provider: 'telegram',
      label: 'Telegram',
      id: name,
      src: `https://t.me/${name}?embed=1`,
      href: `https://t.me/${name}`,
      layout: 'social',
      height: 480,
      allow: VIDEO_ALLOW,
    };
  }

  if (host === 'tiktok.com' || host === 'www.tiktok.com') {
    const id = /\/@[^/]+\/video\/(\d+)/.exec(path)?.[1];
    if (!id) return null;
    return {
      provider: 'tiktok',
      label: 'TikTok',
      id,
      src: `https://www.tiktok.com/embed/v2/${id}`,
      href: url.toString(),
      layout: 'social',
      height: 640,
      allow: VIDEO_ALLOW,
    };
  }

  if (host === 'instagram.com') {
    const match = /^\/(p|reel|tv)\/([A-Za-z0-9_-]+)/.exec(path);
    if (!match) return null;
    const [, kind, id] = match;
    return {
      provider: 'instagram',
      label: 'Instagram',
      id,
      src: `https://www.instagram.com/${kind}/${id}/embed`,
      href: `https://www.instagram.com/${kind}/${id}/`,
      layout: 'social',
      height: 600,
      allow: VIDEO_ALLOW,
    };
  }

  if (host === 'threads.net' || host === 'threads.com') {
    const match = /^\/@([^/]+)\/post\/([A-Za-z0-9_-]+)/.exec(path);
    if (!match) return null;
    const [, user, id] = match;
    return {
      provider: 'threads',
      label: 'Threads',
      id,
      src: `https://www.threads.net/@${user}/post/${id}/embed`,
      href: url.toString(),
      layout: 'social',
      height: 600,
      allow: VIDEO_ALLOW,
    };
  }

  if (host === 'x.com' || host === 'twitter.com') {
    const id = /\/[^/]+\/status\/(\d+)/.exec(path)?.[1];
    if (!id) return null;
    return {
      provider: 'x',
      label: 'X',
      id,
      src: `https://platform.twitter.com/embed/Tweet.html?id=${id}`,
      href: url.toString(),
      layout: 'social',
      height: 520,
      allow: VIDEO_ALLOW,
    };
  }

  if (MASTODON_HOSTS.has(host)) {
    const match = /^\/@([^/]+)\/(\d+)/.exec(path);
    if (!match) return null;
    const [, user, id] = match;
    return {
      provider: 'mastodon',
      label: 'Mastodon',
      id: `${host}/${user}/${id}`,
      src: `https://${host}/@${user}/${id}/embed`,
      href: `https://${host}/@${user}/${id}`,
      layout: 'social',
      height: 520,
      allow: VIDEO_ALLOW,
    };
  }

  return null;
}

/**
 * First supported provider linked from a fragment of article HTML. Feed bodies
 * usually wrap Spotify/Vimeo links in prose, so this is what makes “click the
 * link and it plays here” work without touching the sanitizer.
 */
export function detectEmbedInHtml(html: string | null | undefined): MediaEmbed | null {
  if (!html) return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return null;
  }
  for (const anchor of doc.querySelectorAll('a[href]')) {
    const embed = detectEmbed(anchor.getAttribute('href'));
    if (embed) return embed;
  }
  return null;
}
