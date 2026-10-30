import type { Preferences } from '../types';
import { invokeDesktop, isDesktopApp } from './desktop';
import { store } from '../store/store';

let lastUnread: number | null = null;

export async function setCloseToTray(enabled: boolean): Promise<void> {
  if (!isDesktopApp()) return;
  try {
    await invokeDesktop('set_close_to_tray', { enabled });
  } catch (err) {
    console.warn('Could not update the close-to-tray setting', err);
  }
}

export async function updateTrayUnread(unread: number): Promise<void> {
  if (!isDesktopApp() || lastUnread === unread) return;
  lastUnread = unread;
  try {
    await invokeDesktop('update_tray_unread', { unread });
  } catch (err) {
    console.warn('Could not update the tray tooltip', err);
  }
}

export async function setStartAtLogin(enabled: boolean): Promise<boolean> {
  if (!isDesktopApp()) return false;
  try {
    const { enable, disable } = await import('@tauri-apps/plugin-autostart');
    await (enabled ? enable() : disable());
    return true;
  } catch (err) {
    console.warn('Could not change the start-at-login setting', err);
    return false;
  }
}

/**
 * Apply the stored desktop preferences after hydration, and reconcile the
 * login item with what the OS actually has (the user may have disabled it
 * outside the app).
 */
export async function syncDesktopSettings(prefs: Preferences): Promise<void> {
  if (!isDesktopApp()) return;
  await setCloseToTray(prefs.closeToTray);

  try {
    const { isEnabled } = await import('@tauri-apps/plugin-autostart');
    const actual = await isEnabled();
    if (actual !== prefs.startAtLogin) {
      store.setPreferences({ startAtLogin: actual });
    }
  } catch (err) {
    console.warn('Could not read the autostart state', err);
  }
}
