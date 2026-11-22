/**
 * Where the reader was left in each article.
 *
 * Small and separate from the store on purpose: a scroll position changes
 * dozens of times per second, so it is cached in memory and written on a short
 * timer (and flushed when the reader closes), while the store keeps re-rendering
 * the dashboard. Positions are per article id and capped, because the ids of
 * older articles are pruned from the cache on their own schedule.
 */
const KEY = 'rss-reader:positions';
const MAX_ENTRIES = 300;
const WRITE_DELAY_MS = 250;

interface Position {
  y: number;
  at: number;
}

type Positions = Record<string, Position>;

let cache: Positions | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function isPosition(value: unknown): value is Position {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Position>;
  return typeof candidate.y === 'number' && Number.isFinite(candidate.y) && candidate.y >= 0;
}

function read(): Positions {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const out: Positions = {};
    if (parsed && typeof parsed === 'object') {
      for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (isPosition(value)) out[id] = { y: Math.round(value.y), at: value.at ?? 0 };
      }
    }
    cache = out;
  } catch {
    cache = {};
  }
  return cache;
}

function write(): void {
  if (!cache) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* quota pressure: the position is a convenience, never worth an error */
  }
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    write();
  }, WRITE_DELAY_MS);
}

/** The stored offset for an article, 0 when there is none. */
export function positionFor(articleId: string): number {
  const value = read()[articleId]?.y;
  return value && value > 0 ? Math.round(value) : 0;
}

/**
 * Restoring cannot scroll past the current height: the article may have been
 * opened with full content last time, or the window is narrower now.
 */
export function clampPosition(target: number, max: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  const limit = Number.isFinite(max) && max > 0 ? max : 0;
  return Math.min(Math.round(target), Math.round(limit));
}

/** Remember the offset; written on a short timer, not on every scroll event. */
export function rememberPosition(articleId: string, offset: number): void {
  const y = Number.isFinite(offset) ? Math.max(0, Math.round(offset)) : 0;
  const all = read();
  if (all[articleId]?.y === y) return;
  // Re-inserting keeps the object in least-recently-written order, which is the
  // order the cap prunes by.
  delete all[articleId];
  all[articleId] = { y, at: Date.now() };
  const ids = Object.keys(all);
  if (ids.length > MAX_ENTRIES) {
    for (const id of ids.slice(0, ids.length - MAX_ENTRIES)) delete all[id];
  }
  schedule();
}

/** Write now; called when the reader closes or the app goes away. */
export function flushPositions(): void {
  if (!timer) return;
  clearTimeout(timer);
  timer = null;
  write();
}

/** Drop everything; also used by the tests between cases. */
export function clearReadingPositions(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  cache = {};
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
