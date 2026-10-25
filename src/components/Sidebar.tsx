import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppState, Feed, SidebarSort } from '../types';
import { ALL_FEEDS, folderNameFromViewId, folderViewId } from '../types';
import { store, unreadCount } from '../store/store';
import { useStore } from '../hooks/useStore';
import { byName } from '../lib/opml';
import { FeedIcon } from './FeedIcon';
import { Icon } from './Icon';
import { Dropdown, type DropdownOption } from './Dropdown';

interface SidebarProps {
  onAddFeed: () => void;
  onUnsubscribe: (feed: Feed) => void;
  onRemoveFolder: (folderName: string) => void;
  onClose: () => void;
}

interface FolderGroup {
  name: string;
  feeds: Feed[];
}

const SORT_OPTIONS: Array<DropdownOption<SidebarSort>> = [
  { value: 'name-asc', label: 'Name (A to Z)' },
  { value: 'name-desc', label: 'Name (Z to A)' },
  { value: 'modified-desc', label: 'Last updated (newest)' },
  { value: 'modified-asc', label: 'Last updated (oldest)' },
  { value: 'created-desc', label: 'Date added (newest)' },
  { value: 'created-asc', label: 'Date added (oldest)' },
];

/** A feed's sort key for the "updated"/"added" orders -- falls back to when
 *  it was added if it has never finished a refresh yet. */
function feedTimestamp(feed: Feed, state: AppState, which: 'modified' | 'created'): number {
  if (which === 'created') return feed.addedAt;
  return state.feedState[feed.id]?.updatedAt ?? feed.addedAt;
}

/** Sorts feeds within one folder/ungrouped section. Folder ordering itself
 *  always stays alphabetical (see foldersOf below) -- matches how file
 *  explorers keep folders name-sorted regardless of the chosen file sort. */
function sortFeeds(feeds: Feed[], state: AppState, sort: SidebarSort): Feed[] {
  const list = [...feeds];
  switch (sort) {
    case 'name-desc':
      return list.sort((a, b) => byName(b.title, a.title));
    case 'modified-desc':
      return list.sort((a, b) => feedTimestamp(b, state, 'modified') - feedTimestamp(a, state, 'modified'));
    case 'modified-asc':
      return list.sort((a, b) => feedTimestamp(a, state, 'modified') - feedTimestamp(b, state, 'modified'));
    case 'created-desc':
      return list.sort((a, b) => feedTimestamp(b, state, 'created') - feedTimestamp(a, state, 'created'));
    case 'created-asc':
      return list.sort((a, b) => feedTimestamp(a, state, 'created') - feedTimestamp(b, state, 'created'));
    default:
      return list.sort((a, b) => byName(a.title, b.title));
  }
}

export function Sidebar({
  onAddFeed,
  onUnsubscribe,
  onRemoveFolder,
  onClose,
}: SidebarProps) {
  const state = useStore();
  const [hovered, setHovered] = useState<string | null>(null);
  const [hoveredFolder, setHoveredFolder] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const newFolderRef = useRef<HTMLInputElement>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (creatingFolder) newFolderRef.current?.focus();
  }, [creatingFolder]);

  const onSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      store.setQuery('');
      searchRef.current?.blur();
    }
  };

  const totalUnread = useMemo(
    () => state.feeds.reduce((sum, feed) => sum + unreadCount(state, feed.id), 0),
    [state]
  );

  /**
   * Folders always ordered A-Z (like a file explorer keeps folders
   * name-sorted regardless of the chosen file sort); feeds inside each
   * folder, and the ungrouped list, follow prefs.sidebarSort. An explicitly
   * created empty folder (state.folders) shows even with zero feeds in it.
   */
  const { folders, ungrouped } = useMemo(() => {
    const grouped = new Map<string, Feed[]>();
    const loose: Feed[] = [];

    for (const name of state.folders) grouped.set(name, grouped.get(name) ?? []);
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
      .map(([name, list]) => ({ name, feeds: sortFeeds(list, state, state.prefs.sidebarSort) }));

    return { folders: folderList, ungrouped: sortFeeds(loose, state, state.prefs.sidebarSort) };
  }, [state]);

  const toggleFolder = (name: string) => {
    setCollapsed((current) => ({ ...current, [name]: !current[name] }));
  };

  const selectFolder = (name: string) => {
    store.setActiveFeed(folderViewId(name));
  };

  const allFoldersExpanded = folders.length > 0 && folders.every((f) => !collapsed[f.name]);

  const toggleAllFolders = () => {
    if (allFoldersExpanded) {
      const next: Record<string, boolean> = {};
      for (const folder of folders) next[folder.name] = true;
      setCollapsed(next);
    } else {
      setCollapsed({});
    }
  };

  const submitNewFolder = () => {
    const name = newFolderName.trim();
    if (!name) {
      setCreatingFolder(false);
      return;
    }
    const result = store.createFolder(name);
    if (result.ok) {
      setCreatingFolder(false);
      setNewFolderName('');
    } else if (result.message) {
      store.notify('error', result.message);
    }
  };

  const onNewFolderKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') submitNewFolder();
    else if (event.key === 'Escape') {
      setCreatingFolder(false);
      setNewFolderName('');
    }
  };

  /**
   * Reveal: expand the path to a feed or folder row (if collapsed) and
   * scroll it into view, without changing what's selected as the active
   * filter. Used both automatically (below) and from the toolbar's
   * "Reveal active feed" button, for when the view is fully collapsed and
   * you've lost track of where you are.
   */
  const revealRow = (selector: string, folderName?: string) => {
    if (folderName && collapsed[folderName]) {
      setCollapsed((current) => ({ ...current, [folderName]: false }));
    }
    requestAnimationFrame(() => {
      navRef.current?.querySelector(selector)?.scrollIntoView({ block: 'nearest' });
    });
  };

  const revealFeed = (feedId: string) => {
    const folderName = folders.find((f) => f.feeds.some((feed) => feed.id === feedId))?.name;
    revealRow(`[data-feed-id="${CSS.escape(feedId)}"]`, folderName);
  };

  const revealFolder = (name: string) => {
    revealRow(`[data-folder-name="${CSS.escape(name)}"]`, name);
  };

  /** What "reveal" targets right now: the open article's feed, else the
   *  active filter (a feed, a folder view, or nothing for "All articles"). */
  const revealActiveTarget = () => {
    const article = state.ui.activeArticleId
      ? Object.values(state.articles)
          .flat()
          .find((a) => a.id === state.ui.activeArticleId)
      : null;
    if (article) {
      revealFeed(article.feedId);
      return;
    }
    const folderName = folderNameFromViewId(state.ui.activeFeedId);
    if (folderName) {
      revealFolder(folderName);
      return;
    }
    if (state.ui.activeFeedId && state.ui.activeFeedId !== ALL_FEEDS) {
      revealFeed(state.ui.activeFeedId);
    }
  };

  // Automatic: whenever the open article or the active filter changes.
  useEffect(() => {
    revealActiveTarget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ui.activeArticleId, state.ui.activeFeedId]);

  const renderFeedItem = (feed: Feed) => {
    const unread = unreadCount(state, feed.id);
    const feedState = state.feedState[feed.id];
    const hasError = feedState?.status === 'error';
    const isActive = state.ui.activeFeedId === feed.id;

    return (
      <li
        key={feed.id}
        className="feed-item"
        data-feed-id={feed.id}
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
    <nav className="sidebar" aria-label="Feeds" ref={navRef}>
      <div className="sidebar__header">
        <span className="brand">
          <Icon name="rss" size={18} />
          <span>RSS Reader</span>
        </span>
        <button type="button" className="icon-button sidebar__close" onClick={onClose} aria-label="Close feed list">
          <Icon name="close" />
        </button>
      </div>

      <div className="sidebar__search">
        <Icon name="search" size={16} className="search__icon" />
        <input
          ref={searchRef}
          type="search"
          className="search__input"
          placeholder="Search articles"
          aria-label="Search articles"
          value={state.ui.query}
          onChange={(event) => store.setQuery(event.target.value)}
          onKeyDown={onSearchKey}
          spellCheck={false}
        />
      </div>

      <div className="sidebar__toolbar">
        {creatingFolder ? (
          <input
            ref={newFolderRef}
            type="text"
            className="input sidebar__new-folder-input"
            placeholder="Folder name"
            value={newFolderName}
            onChange={(event) => setNewFolderName(event.target.value)}
            onKeyDown={onNewFolderKey}
            onBlur={submitNewFolder}
          />
        ) : (
          <>
            <button
              type="button"
              className="icon-button"
              onClick={() => setCreatingFolder(true)}
              aria-label="New folder"
              title="New folder"
            >
              <Icon name="folderPlus" size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={onAddFeed}
              aria-label="New feed"
              title="New feed"
            >
              <Icon name="plus" size={16} />
            </button>
            <span className="sidebar__toolbar-spacer" />
            <Dropdown<SidebarSort>
              value={state.prefs.sidebarSort}
              options={SORT_OPTIONS}
              onChange={(sidebarSort) => store.setPreferences({ sidebarSort })}
              label="Sort feeds"
              triggerTitle="Sort feeds"
              icon={<Icon name="sort" size={15} />}
              className="dropdown--icon"
            />
            {folders.length > 0 && (
              <button
                type="button"
                className="icon-button"
                onClick={toggleAllFolders}
                aria-label={allFoldersExpanded ? 'Collapse all folders' : 'Expand all folders'}
                title={allFoldersExpanded ? 'Collapse all folders' : 'Expand all folders'}
              >
                <Icon
                  name="chevronDown"
                  size={14}
                  className={allFoldersExpanded ? 'caret--flipped' : undefined}
                />
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              onClick={revealActiveTarget}
              aria-label="Reveal active feed"
              title="Reveal active feed"
            >
              <Icon name="locate" size={15} />
            </button>
          </>
        )}
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
            const isActive = state.ui.activeFeedId === folderViewId(folder.name);
            const folderUnread = folder.feeds.reduce(
              (sum, feed) => sum + unreadCount(state, feed.id),
              0
            );
            return (
              <li
                className="folder-group"
                key={`folder:${folder.name}`}
                data-folder-name={folder.name}
              >
                <div
                  className="folder-header"
                  onMouseEnter={() => setHoveredFolder(folder.name)}
                  onMouseLeave={() => setHoveredFolder(null)}
                >
                  <button
                    type="button"
                    className="icon-button folder-row__toggle"
                    onClick={() => toggleFolder(folder.name)}
                    aria-expanded={isOpen}
                    aria-label={isOpen ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
                    title={isOpen ? 'Collapse' : 'Expand'}
                  >
                    <Icon name="chevronDown" size={14} className={isOpen ? undefined : 'caret--collapsed'} />
                  </button>

                  <button
                    type="button"
                    className={`feed-row folder-row ${isActive ? 'is-active' : ''}`}
                    onClick={() => selectFolder(folder.name)}
                    aria-current={isActive ? 'page' : undefined}
                    title={`Show articles from “${folder.name}”`}
                  >
                    <Icon name="folder" size={15} className="folder-row__icon" />
                    <span className="feed-row__title">{folder.name}</span>
                    {folderUnread > 0 && (
                      <span className="badge">{folderUnread > 999 ? '999+' : folderUnread}</span>
                    )}
                  </button>

                  {hoveredFolder === folder.name && (
                    <button
                      type="button"
                      className="feed-row__remove icon-button"
                      onClick={() => onRemoveFolder(folder.name)}
                      aria-label={`Delete folder ${folder.name}`}
                      title={`Delete folder “${folder.name}”`}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  )}
                </div>

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
      </div>
    </nav>
  );
}
