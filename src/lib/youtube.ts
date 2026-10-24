/** YouTube video id detection — no API key required. */

const PATTERNS: RegExp[] = [
  /(?:youtube\.com\/watch\?(?:[^&\s]*&)*v=)([A-Za-z0-9_-]{11})/i,
  /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/i,
  /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/i,
  /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/i,
  /(?:youtube\.com\/live\/)([A-Za-z0-9_-]{11})/i,
  /(?:youtube-nocookie\.com\/embed\/)([A-Za-z0-9_-]{11})/i,
  /(?:music\.youtube\.com\/watch\?(?:[^&\s]*&)*v=)([A-Za-z0-9_-]{11})/i,
];

const ID = /^[A-Za-z0-9_-]{11}$/;

/** Extract a YouTube video id from any string, or null. */
export function extractYouTubeId(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const pattern of PATTERNS) {
    const match = pattern.exec(text);
    if (match) return match[1];
  }
  return null;
}

/** Extract the first video id referenced anywhere in an HTML fragment. */
export function extractYouTubeIdFromHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const fromHref = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = fromHref.exec(html)) !== null) {
    const id = extractYouTubeId(match[1]);
    if (id) return id;
  }
  // Bare URLs dropped into text content.
  return extractYouTubeId(html.replace(/<[^>]+>/g, ' '));
}

export function isValidVideoId(id: string): boolean {
  return ID.test(id);
}

export function watchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function embedUrl(id: string): string {
  // nocookie domain: no tracking cookies until the user interacts.
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`;
}
