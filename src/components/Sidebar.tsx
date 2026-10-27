import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppState, Feed, SidebarSort } from '../types';
import {
  ALL_FEEDS,
  folderNameFromViewId,
  folderViewId,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from '../types';
import { store, unreadCount } from '../store/store';
import { useStore } from '../hooks/useStore';
import { byName } from '../lib/opml';
import { copyText } from '../lib/clipboard';
import { FeedIcon } from './FeedIcon';
import { Icon } from './Icon';
import { Dropdown, type DropdownOption } from './Dropdown';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

type ContextTarget =
  | { type: 'feed'; feed: Feed; x: number; y: number }
  | { type: 'folder'; name: string; x: number; y: number }
  | { type: 'all'; x: number; y: number };

interface SidebarProps {
  onAddFeed: () => void;
  onAddFeedInFolder: (folder: string) => void;
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
  onAddFeedInFolder,
  onUnsubscribe,
  onRemoveFolder,
  onClose,
}: SidebarProps) {
  const state = useStore();
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  /** Feed to move once the “New folder…” flow (started from its menu) finishes. */
  const [moveAfterCreate, setMoveAfterCreate] = useState<string | null>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextTarget | null>(null);
  const [renamingFeedId, setRenamingFeedId] = useState<string | null>(null);
  const [renameFeedValue, setRenameFeedValue] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const newFolderRef = useRef<HTMLInputElement>(null);
  const renameFeedRef = useRef<HTMLInputElement>(null);
  const renameFolderRef = useRef<HTMLInputElement>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (creatingFolder) newFolderRef.current?.focus();
  }, [creatingFolder]);

  useEffect(() => {
    if (renamingFeedId) {
      renameFeedRef.current?.focus();
      renameFeedRef.current?.select();
    }
  }, [renamingFeedId]);

  useEffect(() => {
    if (renamingFolder) {
      renameFolderRef.current?.focus();
      renameFolderRef.current?.select();
    }
  }, [renamingFolder]);

  const sidebarWidth = dragWidth ?? state.prefs.sidebarWidth;

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = state.prefs.sidebarWidth;
    const clamp = (w: number) => Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, w));

    setIsResizing(true);
    const onMove = (moveEvent: MouseEvent) => {
      setDragWidth(clamp(startWidth + (moveEvent.clientX - startX)));
    };
    const onUp = (upEvent: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      store.setPreferences({ sidebarWidth: clamp(startWidth + (upEvent.clientX - startX)) });
      setDragWidth(null);
      setIsResizing(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

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

  /** Collapsed folders live in preferences, so they survive a reload. */
  const collapsedSet = useMemo(
    () => new Set(state.prefs.collapsedFolders),
    [state.prefs.collapsedFolders]
  );
  const isCollapsed = (name: string) => collapsedSet.has(name);

  const setFolderCollapsed = (name: string, collapse: boolean) => {
    const current = state.prefs.collapsedFolders;
    if (current.includes(name) === collapse) return;
    store.setPreferences({
      collapsedFolders: collapse
        ? [...current, name]
        : current.filter((folder) => folder !== name),
    });
  };

  const selectAll = () => {
    store.setActiveFeed(ALL_FEEDS);
    onClose();
  };

  const selectFolder = (name: string) => {
    store.setActiveFeed(folderViewId(name));
    onClose();
  };

  const selectFeed = (feedId: string) => {
    store.setActiveFeed(feedId);
    onClose();
  };

  /**
   * One click target per folder row:
   *   collapsed            → expand and filter
   *   expanded, inactive   → filter
   *   expanded and active  → collapse
   */
  const activateFolder = (name: string) => {
    const open = !isCollapsed(name);
    const active = state.ui.activeFeedId === folderViewId(name);
    if (active && open) {
      setFolderCollapsed(name, true);
      return;
    }
    if (!open) setFolderCollapsed(name, false);
    selectFolder(name);
  };

  const anyFolderOpen = folders.some((folder) => !isCollapsed(folder.name));

  const toggleAllFolders = () => {
    store.setPreferences({
      collapsedFolders: anyFolderOpen ? folders.map((folder) => folder.name) : [],
    });
  };

  const beginCreateFolder = (moveFeedId?: string) => {
    setNewFolderName('');
    setMoveAfterCreate(moveFeedId ?? null);
    setCreatingFolder(true);
  };

  const cancelCreateFolder = () => {
    setCreatingFolder(false);
    setNewFolderName('');
    setMoveAfterCreate(null);
  };

  const submitNewFolder = () => {
    const name = newFolderName.trim();
    const moveFeedId = moveAfterCreate;
    cancelCreateFolder();
    if (!name) return;

    const result = store.createFolder(name);
    if (!result.ok) {
      if (result.message) store.notify('error', result.message);
      return;
    }
    if (moveFeedId) store.moveFeedToFolder(moveFeedId, name);
    store.notify('success', moveFeedId ? `Moved feed to “${name}”` : `Created folder “${name}”`);
  };

  const onNewFolderKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') submitNewFolder();
    else if (event.key === 'Escape') cancelCreateFolder();
  };

  const startRenameFeed = (feed: Feed) => {
    setRenamingFeedId(feed.id);
    setRenameFeedValue(feed.title);
  };

  const submitRenameFeed = () => {
    if (!renamingFeedId) return;
    const result = store.renameFeed(renamingFeedId, renameFeedValue);
    if (!result.ok && result.message) store.notify('error', result.message);
    setRenamingFeedId(null);
  };

  const onRenameFeedKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') submitRenameFeed();
    else if (event.key === 'Escape') setRenamingFeedId(null);
  };

  const startRenameFolder = (name: string) => {
    setRenamingFolder(name);
    setRenameFolderValue(name);
  };

  const submitRenameFolder = () => {
    if (!renamingFolder) return;
    const result = store.renameFolder(renamingFolder, renameFolderValue);
    if (!result.ok && result.message) store.notify('error', result.message);
    setRenamingFolder(null);
  };

  const onRenameFolderKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') submitRenameFolder();
    else if (event.key === 'Escape') setRenamingFolder(null);
  };

  const openExternal = (url: string | undefined) => {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const copyValue = async (value: string, label: string) => {
    const ok = await copyText(value);
    store.notify(
      ok ? 'success' : 'error',
      ok ? `${label} copied to the clipboard` : `Could not copy ${label.toLowerCase()}`
    );
  };

  const setArticlesRead = (ids: string[], read: boolean, label: string) => {
    if (!ids.length) {
      store.notify('info', 'No cached articles in this view yet.');
      return;
    }
    if (read) store.markAllRead(ids);
    else store.markAllUnread(ids);
    store.notify('success', `${read ? 'Marked all as read' : 'Marked all as unread'} — ${label}`);
  };

  const feedContextItems = (feed: Feed): ContextMenuItem[] => {
    const ids = (state.articles[feed.id] ?? []).map((article) => article.id);
    const unread = unreadCount(state, feed.id);
    const otherFolders = folders
      .map((folder) => folder.name)
      .filter((name) => name !== feed.folder?.trim());

    const items: ContextMenuItem[] = [
      {
        icon: 'external',
        label: 'Open website',
        onSelect: () => openExternal(feed.siteUrl ?? feed.url),
      },
      {
        icon: 'refresh',
        label: 'Refresh feed',
        onSelect: () => {
          void store.refreshFeed(feed.id);
          store.notify('info', `Refreshing “${feed.title}”…`);
        },
      },
      { type: 'divider' },
      {
        icon: 'eye',
        label: 'Mark all as read',
        disabled: unread === 0,
        onSelect: () => setArticlesRead(ids, true, feed.title),
      },
      {
        icon: 'eyeOff',
        label: 'Mark all as unread',
        disabled: ids.length === 0,
        onSelect: () => setArticlesRead(ids, false, feed.title),
      },
      { icon: 'copy', label: 'Copy feed URL', onSelect: () => void copyValue(feed.url, 'Feed URL') },
      { type: 'divider' },
      { icon: 'pencil', label: 'Rename feed', onSelect: () => startRenameFeed(feed) },
      { type: 'label', label: 'Move to folder' },
    ];

    if (feed.folder) {
      items.push({
        icon: 'folder',
        label: 'No folder',
        onSelect: () => store.moveFeedToFolder(feed.id, undefined),
      });
    }
    for (const name of otherFolders) {
      items.push({
        icon: 'folder',
        label: name,
        onSelect: () => store.moveFeedToFolder(feed.id, name),
      });
    }
    items.push({
      icon: 'folderPlus',
      label: 'New folder…',
      onSelect: () => beginCreateFolder(feed.id),
    });
    items.push({ type: 'divider' });
    items.push({
      icon: 'trash',
      label: 'Unsubscribe',
      danger: true,
      onSelect: () => onUnsubscribe(feed),
    });
    return items;
  };

  const folderContextItems = (name: string): ContextMenuItem[] => {
    const folderFeeds = state.feeds.filter((feed) => feed.folder?.trim() === name);
    const ids = folderFeeds
      .flatMap((feed) => state.articles[feed.id] ?? [])
      .map((article) => article.id);
    const unread = folderFeeds.reduce((sum, feed) => sum + unreadCount(state, feed.id), 0);
    const open = !isCollapsed(name);

    return [
      { icon: 'folder', label: 'Open folder', onSelect: () => selectFolder(name) },
      {
        icon: 'plus',
        label: 'Add feed to this folder',
        onSelect: () => {
          onClose();
          onAddFeedInFolder(name);
        },
      },
      { type: 'divider' },
      {
        icon: 'eye',
        label: 'Mark folder as read',
        disabled: unread === 0,
        onSelect: () => setArticlesRead(ids, true, name),
      },
      {
        icon: 'eyeOff',
        label: 'Mark folder as unread',
        disabled: ids.length === 0,
        onSelect: () => setArticlesRead(ids, false, name),
      },
      {
        icon: 'copy',
        label: 'Copy folder name',
        onSelect: () => void copyValue(name, 'Folder name'),
      },
      { type: 'divider' },
      { icon: 'pencil', label: 'Rename folder', onSelect: () => startRenameFolder(name) },
      {
        icon: open ? 'collapse' : 'expand',
        label: open ? 'Collapse folder' : 'Expand folder',
        onSelect: () => setFolderCollapsed(name, open),
      },
      { icon: 'folderPlus', label: 'New folder…', onSelect: () => beginCreateFolder() },
      { type: 'divider' },
      {
        icon: 'trash',
        label: 'Delete folder',
        danger: true,
        onSelect: () => onRemoveFolder(name),
      },
    ];
  };

  const allContextItems = (): ContextMenuItem[] => {
    const ids = Object.values(state.articles)
      .flat()
      .map((article) => article.id);
    return [
      { icon: 'refresh', label: 'Refresh all feeds', onSelect: () => void store.refreshAll() },
      { type: 'divider' },
      {
        icon: 'eye',
        label: 'Mark all as read',
        disabled: totalUnread === 0,
        onSelect: () => setArticlesRead(ids, true, 'all articles'),
      },
      {
        icon: 'eyeOff',
        label: 'Mark all as unread',
        disabled: ids.length === 0,
        onSelect: () => setArticlesRead(ids, false, 'all articles'),
      },
      { type: 'divider' },
      { icon: 'folderPlus', label: 'New folder', onSelect: () => beginCreateFolder() },
      { icon: 'plus', label: 'Add feed', onSelect: onAddFeed },
    ];
  };

  /**
   * Reveal: expand the path to a feed or folder row (if collapsed) and
   * scroll it into view, without changing what's selected as the active
   * filter. Used both automatically (below) and from the toolbar's
   * "Reveal active feed" button, for when the view is fully collapsed and
   * you've lost track of where you are.
   */
  const revealRow = (selector: string, folderName?: string) => {
    if (folderName && isCollapsed(folderName)) setFolderCollapsed(folderName, false);
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

  const menuAtButton = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom + 4 };
  };

  const renderFeedItem = (feed: Feed) => {
    const unread = unreadCount(state, feed.id);
    const feedState = state.feedState[feed.id];
    const hasError = feedState?.status === 'error';
    const isActive = state.ui.activeFeedId === feed.id;
    const isRenaming = renamingFeedId === feed.id;

    return (
      <li
        key={feed.id}
        className={`feed-item ${isActive ? 'is-active' : ''}`}
        data-feed-id={feed.id}
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({ type: 'feed', feed, x: event.clientX, y: event.clientY });
        }}
      >
        {isRenaming ? (
          <div className="feed-row feed-row--renaming">
            <FeedIcon feed={feed} />
            <input
              ref={renameFeedRef}
              type="text"
              className="input sidebar__rename-input"
              value={renameFeedValue}
              onChange={(event) => setRenameFeedValue(event.target.value)}
              onKeyDown={onRenameFeedKey}
              onBlur={submitRenameFeed}
            />
          </div>
        ) : (
          <button
            type="button"
            className={`feed-row ${isActive ? 'is-active' : ''}`}
            onClick={() => selectFeed(feed.id)}
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
        )}

        {!isRenaming && (
          <div className="feed-row__actions">
            <button
              type="button"
              className="icon-button"
              onClick={(event) => {
                const { x, y } = menuAtButton(event);
                setContextMenu({ type: 'feed', feed, x, y });
              }}
              aria-label={`More actions for ${feed.title}`}
              title="More actions"
            >
              <Icon name="more" size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => onUnsubscribe(feed)}
              aria-label={`Unsubscribe from ${feed.title}`}
              title="Unsubscribe"
            >
              <Icon name="trash" size={15} />
            </button>
          </div>
        )}
      </li>
    );
  };

  return (
    <nav
      className={`sidebar ${isResizing ? 'sidebar--resizing' : ''}`}
      aria-label="Feeds"
      ref={navRef}
      style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
    >
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
            placeholder={moveAfterCreate ? 'Move to new folder…' : 'Folder name'}
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
              onClick={() => beginCreateFolder()}
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
                aria-label={anyFolderOpen ? 'Collapse all folders' : 'Expand all folders'}
                title={anyFolderOpen ? 'Collapse all folders' : 'Expand all folders'}
              >
                <Icon name={anyFolderOpen ? 'collapse' : 'expand'} size={15} />
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
          <li
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu({ type: 'all', x: event.clientX, y: event.clientY });
            }}
          >
            <button
              type="button"
              className={`feed-row ${state.ui.activeFeedId === ALL_FEEDS ? 'is-active' : ''}`}
              onClick={selectAll}
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
            const isOpen = !isCollapsed(folder.name);
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
                  className={`folder-header ${isActive ? 'is-active' : ''}`}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({ type: 'folder', name: folder.name, x: event.clientX, y: event.clientY });
                  }}
                >
                  {renamingFolder === folder.name ? (
                    <div className="feed-row folder-row folder-row--renaming">
                      <Icon name="folder" size={15} className="folder-row__icon" />
                      <input
                        ref={renameFolderRef}
                        type="text"
                        className="input sidebar__rename-input"
                        value={renameFolderValue}
                        onChange={(event) => setRenameFolderValue(event.target.value)}
                        onKeyDown={onRenameFolderKey}
                        onBlur={submitRenameFolder}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={`feed-row folder-row ${isActive ? 'is-active' : ''}`}
                      onClick={() => activateFolder(folder.name)}
                      aria-expanded={isOpen}
                      aria-current={isActive ? 'page' : undefined}
                      title={
                        isActive && isOpen
                          ? `Collapse “${folder.name}”`
                          : `Show articles from “${folder.name}”`
                      }
                    >
                      <Icon
                        name="chevronDown"
                        size={14}
                        className={`folder-row__caret ${isOpen ? '' : 'caret--collapsed'}`}
                      />
                      <Icon name="folder" size={15} className="folder-row__icon" />
                      <span className="feed-row__title">{folder.name}</span>
                      {folderUnread > 0 && (
                        <span className="badge">{folderUnread > 999 ? '999+' : folderUnread}</span>
                      )}
                    </button>
                  )}

                  {renamingFolder !== folder.name && (
                    <div className="feed-row__actions">
                      <button
                        type="button"
                        className="icon-button"
                        onClick={(event) => {
                          const { x, y } = menuAtButton(event);
                          setContextMenu({ type: 'folder', name: folder.name, x, y });
                        }}
                        aria-label={`More actions for folder ${folder.name}`}
                        title="More actions"
                      >
                        <Icon name="more" size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => onRemoveFolder(folder.name)}
                        aria-label={`Delete folder ${folder.name}`}
                        title={`Delete folder “${folder.name}”`}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
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

      <div
        className="sidebar__resize-handle"
        onMouseDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize"
      />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={
            contextMenu.type === 'feed'
              ? feedContextItems(contextMenu.feed)
              : contextMenu.type === 'folder'
                ? folderContextItems(contextMenu.name)
                : allContextItems()
          }
          onClose={() => setContextMenu(null)}
        />
      )}
    </nav>
  );
}
