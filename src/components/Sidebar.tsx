import { useMemo, useState } from 'react';
import type { Feed } from '../types';
import { ALL_FEEDS } from '../types';
import { store, unreadCount } from '../store/store';
import { useStore } from '../hooks/useStore';
import { faviconUrl } from '../lib/url';
import { Icon } from './Icon';

interface SidebarProps {
  onAddFeed: () => void;
  onImport: () => void;
  onExport: () => void;
  onSettings: () => void;
  onUnsubscribe: (feed: Feed) => void;
  onClose: () => void;
}

function FeedIcon({ feed }: { feed: Feed }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : feed.iconUrl || faviconUrl(feed);
  const letter = (feed.title || '?').trim().charAt(0).toUpperCase();

  if (!src) {
    return (
      <span className="feed-icon feed-icon--letter" aria-hidden="true">
        {letter}
      </span>
    );
  }
  return (
    <img
      className="feed-icon"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

export function Sidebar({ onAddFeed, onImport, onExport, onSettings, onUnsubscribe, onClose }: SidebarProps) {
  const state = useStore();
  const [hovered, setHovered] = useState<string | null>(null);

  const totalUnread = useMemo(
    () => state.feeds.reduce((sum, feed) => sum + unreadCount(state, feed.id), 0),
    [state]
  );

  const sortedFeeds = useMemo(
    () => [...state.feeds].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })),
    [state.feeds]
  );

  return (
    <nav className="sidebar" aria-label="Feeds">
      <div className="sidebar__header">
        <span className="brand">
          <Icon name="rss" size={18} />
          <span>RSS Reader</span>
        </span>
        <button type="button" className="icon-button sidebar__close" onClick={onClose} aria-label="Close feed list">
          <Icon name="close" />
        </button>
      </div>

      <div className="sidebar__scroll">
        <ul className="feed-list" role="list">
          <li>
            <button
              type="button"
              className={`feed-row ${state.ui.activeFeedId === ALL_FEEDS ? 'is-active' : ''}`}
              onClick={() => store.setActiveFeed(ALL_FEEDS)}
              aria-current={state.ui.activeFeedId === ALL_FEEDS ? 'page' : undefined}
            >
              <span className="feed-icon feed-icon--all" aria-hidden="true">
                <Icon name="inbox" size={16} />
              </span>
              <span className="feed-row__title">All articles</span>
              {totalUnread > 0 && <span className="badge">{totalUnread > 999 ? '999+' : totalUnread}</span>}
            </button>
          </li>

          {sortedFeeds.map((feed) => {
            const unread = unreadCount(state, feed.id);
            const feedState = state.feedState[feed.id];
            const hasError = feedState?.status === 'error';
            const isActive = state.ui.activeFeedId === feed.id;

            return (
              <li
                key={feed.id}
                className="feed-item"
                onMouseEnter={() => setHovered(feed.id)}
                onMouseLeave={() => setHovered(null)}
              >
                <button
                  type="button"
                  className={`feed-row ${isActive ? 'is-active' : ''}`}
                  onClick={() => store.setActiveFeed(feed.id)}
                  aria-current={isActive ? 'page' : undefined}
                  title={feed.description || feed.title}
                >
                  <FeedIcon feed={feed} />
                  <span className="feed-row__title">{feed.title}</span>
                  {hasError && (
                    <span className="status-dot" title={feedState?.message} aria-label="Feed has an error">
                      !
                    </span>
                  )}
                  {unread > 0 && <span className="badge">{unread > 999 ? '999+' : unread}</span>}
                </button>

                {(hovered === feed.id || isActive) && (
                  <button
                    type="button"
                    className="feed-row__remove icon-button"
                    onClick={() => onUnsubscribe(feed)}
                    aria-label={`Unsubscribe from ${feed.title}`}
                    title="Unsubscribe"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                )}
              </li>
            );
          })}

          {state.feeds.length === 0 && state.hydrated && (
            <li className="feed-list__empty">
              <p>No feeds yet.</p>
              <button type="button" className="link-button" onClick={onAddFeed}>
                Add your first feed
              </button>
            </li>
          )}
        </ul>
      </div>

      <div className="sidebar__footer">
        <button type="button" className="button button--primary sidebar__cta" onClick={onAddFeed}>
          <Icon name="plus" size={16} />
          <span>Add feed</span>
        </button>

        <div className="sidebar__actions">
          <button type="button" className="ghost-button" onClick={onImport}>
            <Icon name="upload" size={15} />
            <span>Import</span>
          </button>
          <button type="button" className="ghost-button" onClick={onExport} disabled={!state.feeds.length}>
            <Icon name="download" size={15} />
            <span>Export</span>
          </button>
          <button type="button" className="ghost-button" onClick={onSettings}>
            <Icon name="settings" size={15} />
            <span>Settings</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
