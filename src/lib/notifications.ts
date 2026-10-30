import { invokeDesktop, isDesktopApp } from './desktop';
import { summarizeNotifications, type NotificationItem } from './notificationSummary';

interface QueueArgs {
  feedId: string;
  feedTitle: string;
  count: number;
  enabled: boolean;
  muted: boolean;
}

let pending = new Map<string, NotificationItem>();
let timer: ReturnType<typeof setTimeout> | null = null;
let permission: boolean | null = null;

async function ensurePermission(): Promise<boolean> {
  if (!isDesktopApp()) return false;
  if (permission !== null) return permission;

  try {
    const { isPermissionGranted, requestPermission } = await import(
      '@tauri-apps/plugin-notification'
    );
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
    permission = granted;
    return granted;
  } catch (err) {
    console.warn('Could not request notification permission', err);
    permission = false;
    return false;
  }
}

/** Used by the Settings toggle so the OS prompt appears when it is enabled. */
export async function requestNotificationPermission(): Promise<boolean> {
  permission = null;
  return ensurePermission();
}

function backgrounded(): boolean {
  return document.visibilityState !== 'visible' || !document.hasFocus();
}

/**
 * WebView2 keeps reporting `visible`/`focused` even when the Tauri window is
 * hidden in the tray, so ask the native window. The DOM fallback is only for
 * non-desktop contexts.
 */
async function windowIsActive(): Promise<boolean> {
  if (!isDesktopApp()) return !backgrounded();
  try {
    return await invokeDesktop<boolean>('is_main_window_active');
  } catch {
    return !backgrounded();
  }
}

/**
 * Queue new articles for one batched notification. Store passes the current
 * preference/mute state so this module does not import the store (avoids a
 * cycle with refreshFeed). The foreground check happens at flush time.
 */
export function queueNewArticles(args: QueueArgs): void {
  if (!isDesktopApp() || !args.enabled || args.muted || args.count <= 0) return;

  const previous = pending.get(args.feedId);
  pending.set(args.feedId, {
    feed: args.feedTitle,
    count: (previous?.count ?? 0) + args.count,
  });

  if (timer === null) {
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, 1_500);
  }
}

async function flush(): Promise<void> {
  const items = [...pending.values()];
  pending = new Map();
  if (!items.length) return;
  // The user may have opened the app while the batch was waiting.
  if (await windowIsActive()) return;

  const summary = summarizeNotifications(items);
  if (!summary) return;
  if (!(await ensurePermission())) return;

  try {
    const { sendNotification } = await import('@tauri-apps/plugin-notification');
    await sendNotification({ title: summary.title, body: summary.body });
  } catch (err) {
    console.warn('Could not show notification', err);
  }
}
