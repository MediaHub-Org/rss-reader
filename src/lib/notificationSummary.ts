import { plural, t } from './i18n';

export interface NotificationItem {
  feed: string;
  count: number;
}

/**
 * Turn the articles found during one refresh into a single notification.
 * Grouping feeds avoids a burst of one notification per feed.
 */
export function summarizeNotifications(
  items: NotificationItem[]
): { title: string; body: string } | null {
  const cleaned = items
    .map((item) => ({ feed: item.feed.trim(), count: Math.max(0, Math.floor(item.count)) }))
    .filter((item) => item.feed && item.count > 0);
  if (!cleaned.length) return null;

  const total = cleaned.reduce((sum, item) => sum + item.count, 0);
  if (cleaned.length === 1) {
    return {
      title: t('New articles in {feed}', { feed: cleaned[0].feed }),
      body: plural(total, '{count} new article', '{count} new articles'),
    };
  }

  const names = cleaned
    .slice(0, 3)
    .map((item) => `${item.feed} (${item.count})`)
    .join(', ');
  const more = cleaned.length > 3 ? ` ${t('+{count} more', { count: cleaned.length - 3 })}` : '';
  return {
    title: plural(total, '{count} new article', '{count} new articles'),
    body: t('Across {label}: {names}{more}', {
      label: plural(cleaned.length, '{count} feed', '{count} feeds'),
      names,
      more,
    }),
  };
}
