import { isDesktopApp } from './desktop';

/** Listen for the tray's "Refresh feeds" action. No-op in the browser. */
export async function listenForTrayRefresh(handler: () => void): Promise<() => void> {
  if (!isDesktopApp()) return () => {};

  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen('tray-refresh', () => handler());
  } catch (err) {
    console.warn('Could not listen for tray events', err);
    return () => {};
  }
}
