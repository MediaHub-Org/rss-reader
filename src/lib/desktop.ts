/**
 * Desktop (Tauri) bridge.
 *
 * The web/PWA build never enters these branches: Tauri injects
 * `__TAURI_INTERNALS__` into its WebView only. Keeping the detection here means
 * the rest of the app can stay browser-first and the desktop-only calls are
 * loaded on demand.
 */

export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export type SaveOutcome = 'saved' | 'cancelled' | 'error';

type TauriCore = typeof import('@tauri-apps/api/core');
let corePromise: Promise<TauriCore> | null = null;

/** Load the Tauri API once, and only in the desktop shell. */
function tauriCore(): Promise<TauriCore> {
  corePromise ??= import('@tauri-apps/api/core');
  return corePromise;
}

export async function invokeDesktop<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  const { invoke } = await tauriCore();
  return invoke<T>(command, args);
}

export async function openExternalUrl(url: string): Promise<void> {
  try {
    await invokeDesktop('open_external', { url });
  } catch (err) {
    console.error('Could not open the external link', err);
  }
}

/** Native Save dialog + write. */
export async function saveTextFile(filename: string, contents: string): Promise<SaveOutcome> {
  try {
    const saved = await invokeDesktop<boolean>('save_text_file', {
      name: filename,
      contents,
    });
    return saved ? 'saved' : 'cancelled';
  } catch (err) {
    console.error('Could not save the file', err);
    return 'error';
  }
}

/**
 * Keep external navigation outside the app window:
 *  - feed/article links go to the default browser;
 *  - `window.open` (used by the context menus) does the same;
 *  - links already handled by the app (inline media) are left alone because
 *    their React handler has called preventDefault by the time this runs.
 */
export function installDesktopLinkHandling(): void {
  if (!isDesktopApp()) return;

  window.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.href;
    if (!/^https?:/i.test(href)) return;
    event.preventDefault();
    void openExternalUrl(href);
  });

  const nativeOpen = window.open.bind(window);
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const href = url == null ? '' : String(url);
    if (/^https?:/i.test(href)) {
      void openExternalUrl(href);
      return null;
    }
    return nativeOpen(url as string, target, features);
  }) as typeof window.open;
}
