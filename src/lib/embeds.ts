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
  | 'apple-music';

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
  /** `video` gets a 16:9 box, `audio` uses the provider’s pixel height. */
  layout: 'video' | 'audio';
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
};

/** Spotify is taller for containers (album/playlist/show) than for one track. */
function spotifyHeight(kind: string): number {
  return kind === 'track' || kind === 'episode' ? 152 : 352;
}

/** Deezer’s one-line player for a track, a full widget for a collection. */
function deezerHeight(kind: string): number {
  return kind === 'track' ? 90 : 300;
}

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
