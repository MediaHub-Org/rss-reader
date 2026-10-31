import { isDesktopApp, isTauriApp } from './desktop';

const REPO = 'MediaHub-Org/rss-reader';
const CHECK_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const CACHE_KEY = 'rss-reader:update-check';
const CACHE_MS = 6 * 60 * 60 * 1000;

export interface UpdateInfo {
  version: string;
  releaseUrl: string;
  /** Direct installer/APK for this platform, when the release has one. */
  downloadUrl?: string;
  notes?: string;
}

interface CachedCheck {
  checkedAt: number;
  latest?: UpdateInfo;
}

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
  body?: string;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
}

/** Numeric semver comparison; prerelease suffixes are ignored for ordering. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const clean = (value: string) =>
    value
      .trim()
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = clean(candidate);
  const b = clean(current);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if ((a[index] ?? 0) > (b[index] ?? 0)) return true;
    if ((a[index] ?? 0) < (b[index] ?? 0)) return false;
  }
  return false;
}

function platformSuffix(): string | null {
  if (isTauriApp() && !isDesktopApp()) return '.apk';
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Macintosh|Mac OS X/i.test(ua)) return '.dmg';
  if (/Windows/i.test(ua)) return 'x64-setup.exe';
  if (/Linux/i.test(ua)) return '.AppImage';
  return null;
}

/** Prefer the asset that matches the running platform. */
export function pickDownloadUrl(assets: GitHubRelease['assets']): string | undefined {
  const suffix = platformSuffix();
  if (!suffix) return undefined;
  return assets?.find((asset) => asset.name?.endsWith(suffix))?.browser_download_url;
}

function readCache(): CachedCheck | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedCheck;
    if (!parsed || typeof parsed.checkedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(latest: UpdateInfo | undefined): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ checkedAt: Date.now(), latest } satisfies CachedCheck));
  } catch {
    // Update checks still work when storage is unavailable.
  }
}

/**
 * Ask GitHub for the latest release and return it only when it is newer than
 * the running build. Manual checks bypass the six-hour cache.
 */
export async function checkForUpdate(options: { force?: boolean } = {}): Promise<UpdateInfo | null> {
  const cached = readCache();
  if (!options.force && cached && Date.now() - cached.checkedAt < CACHE_MS) {
    return cached.latest ?? null;
  }

  const response = await fetch(CHECK_URL, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);

  const release = (await response.json()) as GitHubRelease;
  const version = (release.tag_name ?? '').replace(/^v/i, '').trim();
  if (!version) throw new Error('The release has no version tag.');

  if (!isNewerVersion(version, __APP_VERSION__)) {
    writeCache(undefined);
    return null;
  }

  const info: UpdateInfo = {
    version,
    releaseUrl: release.html_url ?? `https://github.com/${REPO}/releases/latest`,
    downloadUrl: pickDownloadUrl(release.assets),
    notes: release.body,
  };
  writeCache(info);
  return info;
}
