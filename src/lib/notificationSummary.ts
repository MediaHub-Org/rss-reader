import { countLabel } from './format';

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
      title: `New articles in ${cleaned[0].feed}`,
      body: countLabel(total, 'new article'),
    };
  }

  const names = cleaned
    .slice(0, 3)
    .map((item) => `${item.feed} (${item.count})`)
    .join(', ');
  const more = cleaned.length > 3 ? ` +${cleaned.length - 3} more` : '';
  return {
    title: `${total} new articles`,
    body: `Across ${countLabel(cleaned.length, 'feed')}: ${names}${more}`,
  };
}
