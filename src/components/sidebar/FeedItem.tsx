import type { Feed, FeedState } from '../../types';
import { FeedIcon } from '../FeedIcon';
import { Icon } from '../Icon';
import { t } from '../../lib/i18n';

interface FeedItemProps {
  feed: Feed;
  unread: number;
  feedState?: FeedState;
  isActive: boolean;
  onSelect: () => void;
  onMenu: (feed: Feed, x: number, y: number) => void;
}

/** One feed row in the sidebar, including its hover actions. */
export function FeedItem({
  feed,
  unread,
  feedState,
  isActive,
  onSelect,
  onMenu,
}: FeedItemProps) {
  const hasError = feedState?.status === 'error';
  const retryHint = feedState?.nextRetryAt
    ? ` · next automatic retry ${new Date(feedState.nextRetryAt).toLocaleTimeString()}`
    : '';

  return (
    <li
      className={`feed-item ${isActive ? 'is-active' : ''}`}
      data-feed-id={feed.id}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(feed, event.clientX, event.clientY);
      }}
    >
      <button
        type="button"
        className={`feed-row ${isActive ? 'is-active' : ''}`}
        onClick={onSelect}
        aria-current={isActive ? 'page' : undefined}
        title={feed.description || feed.title}
      >
        <FeedIcon feed={feed} />
        <span className="feed-row__title">{feed.title}</span>
        {hasError && (
          <span
            className="status-dot"
            title={`${feedState?.message ?? t('Feed error')}${retryHint}`}
            aria-label={t('Feed has an error')}
          >
            !
          </span>
        )}
        {unread > 0 && <span className="badge">{unread > 999 ? '999+' : unread}</span>}
      </button>

      <div className="feed-row__actions">
        <button
          type="button"
          className="icon-button"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onMenu(feed, rect.left, rect.bottom + 4);
          }}
          aria-label={`${t('More actions')} · ${feed.title}`}
          title={t('More actions')}
        >
          <Icon name="more" size={15} />
        </button>
      </div>
    </li>
  );
}
