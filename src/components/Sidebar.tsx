import { useMemo, useState } from 'react';
import type { Feed } from '../types';
import { ALL_FEEDS } from '../types';
import { store, unreadCount } from '../store/store';
import { useStore } from '../hooks/useStore';
import { byName } from '../lib/opml';
import { FeedIcon } from './FeedIcon';
import { Icon } from './Icon';

interface SidebarProps {
  onAddFeed: () => void;
  onImport: () => void;
  onExport: () => void;
  onSettings: () => void;
  onUnsubscribe: (feed: Feed) => void;
  onClose: () => void;
}

interface FolderGroup {
  name: string;
  feeds: Feed[];
}

export function Sidebar({ onAddFeed, onImport, onExport, onSettings, onUnsubscribe, onClose }: SidebarProps) {
  const state = useStore();
  const [hovered, setHovered] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const totalUnread = useMemo(
    () => state.feeds.reduce((sum, feed) => sum + unreadCount(state, feed.id), 0),
    [state]
  );

  /**
   * Folders sorted A–Z with their feeds sorted A–Z inside, followed by any
   * ungrouped feeds sorted A–Z.
   */
  const { folders, ungrouped } = useMemo(() => {
    const byTitle = (a: Feed, b: Feed) => byName(a.title, b.title);
    const grouped = new Map<string, Feed[]>();
    const loose: Feed[] = [];

    for (const feed of state.feeds) {
      const folder = feed.folder?.trim();
      if (!folder) {
        loose.push(feed);
        continue;
      }
      grouped.set(folder, [...(grouped.get(folder) ?? []), feed]);
    }

    const folderList: FolderGroup[] = [...grouped.entries()]
      .sort(([a], [b]) => byName(a, b))
      .map(([name, list]) => ({ name, feeds: list.sort(byTitle) }));

    return { folders: folderList, ungrouped: loose.sort(byTitle) };
  }, [state.feeds]);

  const toggleFolder = (name: string) => {
    setCollapsed((current) => ({ ...current, [name]: !current[name] }));
  };

  const renderFeedItem = (feed: Feed) => {
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
  };

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

          {folders.map((folder) => {
            const isOpen = !collapsed[folder.name];
            const folderUnread = folder.feeds.reduce(
              (sum, feed) => sum + unreadCount(state, feed.id),
              0
            );
            return (
              <li className="folder-group" key={`folder:${folder.name}`}>
                <button
                  type="button"
                  className={`feed-row folder-row ${isOpen ? 'is-open' : ''}`}
                  onClick={() => toggleFolder(folder.name)}
                  aria-expanded={isOpen}
                >
                  <Icon name="chevronDown" size={14} className="folder-row__caret" />
                  <Icon name="folder" size={15} className="folder-row__icon" />
                  <span className="feed-row__title">{folder.name}</span>
                  {folderUnread > 0 && (
                    <span className="badge">{folderUnread > 999 ? '999+' : folderUnread}</span>
                  )}
                </button>

                {isOpen && (
                  <ul className="feed-list feed-list--nested" role="list">
                    {folder.feeds.map(renderFeedItem)}
                  </ul>
                )}
              </li>
            );
          })}

          {ungrouped.map(renderFeedItem)}

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
