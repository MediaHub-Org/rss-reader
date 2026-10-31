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
import { byName } from '../lib/portability';
import { isDesktopApp } from '../lib/desktop';
import { copyText } from '../lib/clipboard';
import { Icon } from './Icon';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { FolderPickerDialog } from './FolderPickerDialog';
import { CreateFolderDialog } from './CreateFolderDialog';
import { FeedItem } from './sidebar/FeedItem';
import { SidebarHeader } from './sidebar/SidebarHeader';
import { SidebarToolbar } from './sidebar/SidebarToolbar';

type ContextTarget =
  | { type: 'feed'; feed: Feed; x: number; y: number }
  | { type: 'folder'; name: string; x: number; y: number }
  | { type: 'all'; x: number; y: number };

interface SidebarProps {
  onAddFeed: () => void;
  onAddFeedInFolder: (folder: string) => void;
  onUnsubscribe: (feed: Feed) => void;
  onRemoveFolder: (folderName: string) => void;
  onManageSources: () => void;
  onManageGroups: () => void;
  onClose: () => void;
}

interface FolderGroup {
  name: string;
  feeds: Feed[];
}

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
  onManageSources,
  onManageGroups,
  onClose,
}: SidebarProps) {
  const state = useStore();
  const [creatingFolder, setCreatingFolder] = useState(false);
  /** Feed to move once the “New folder…” flow (started from its menu) finishes. */
  const [moveAfterCreate, setMoveAfterCreate] = useState<string | null>(null);
  /** Feed whose “Move to folder…” picker is open. */
  const [moveFeed, setMoveFeed] = useState<Feed | null>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextTarget | null>(null);
  const [renamingFeedId, setRenamingFeedId] = useState<string | null>(null);
  const [renameFeedValue, setRenameFeedValue] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const renameFeedRef = useRef<HTMLInputElement>(null);
  const renameFolderRef = useRef<HTMLInputElement>(null);
  const navRef = useRef<HTMLElement>(null);

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
   * The name is a plain filter: it never expands or collapses the folder.
   * Disclosure belongs to the caret on the left, so clicking a collapsed
   * folder filters its articles but leaves the feed list as it was.
   */
  const openFolder = (name: string) => {
    selectFolder(name);
  };

  const anyFolderOpen = folders.some((folder) => !isCollapsed(folder.name));

  const toggleAllFolders = () => {
    store.setPreferences({
      collapsedFolders: anyFolderOpen ? folders.map((folder) => folder.name) : [],
    });
  };

  const beginCreateFolder = (moveFeedId?: string) => {
    setMoveAfterCreate(moveFeedId ?? null);
    setCreatingFolder(true);
  };

  const cancelCreateFolder = () => {
    setCreatingFolder(false);
    setMoveAfterCreate(null);
  };

  /** Return an error message for the dialog, or null on success. */
  const createFolder = (name: string): string | null => {
    const moveFeedId = moveAfterCreate;
    const result = store.createFolder(name);
    if (!result.ok) return result.message ?? 'Could not create that folder.';

    if (moveFeedId) store.moveFeedToFolder(moveFeedId, name);
    store.notify('success', moveFeedId ? `Moved feed to “${name}”` : `Created folder “${name}”`);
    return null;
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
    const notificationsMuted = state.prefs.mutedFeedIds.includes(feed.id);

    return [
      {
        icon: 'external',
        label: 'Open website',
        onSelect: () => openExternal(feed.siteUrl ?? feed.url),
      },
      {
        icon: 'refresh',
        label: 'Refresh feed',
        onSelect: () => {
          void store.refreshFeed(feed.id, { force: true });
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
      ...(isDesktopApp()
        ? [
            {
              icon: notificationsMuted ? 'bellOff' : 'bell',
              label: notificationsMuted ? 'Unmute notifications' : 'Mute notifications',
              onSelect: () => {
                const nowMuted = store.toggleMutedFeed(feed.id);
                store.notify(
                  'success',
                  nowMuted
                    ? `Notifications muted for “${feed.title}”`
                    : `Notifications on for “${feed.title}”`
                );
              },
            } satisfies ContextMenuItem,
          ]
        : []),
      { icon: 'copy', label: 'Copy feed URL', onSelect: () => void copyValue(feed.url, 'Feed URL') },
      { type: 'divider' },
      { icon: 'pencil', label: 'Rename feed', onSelect: () => startRenameFeed(feed) },
      // One searchable picker instead of one menu item per folder: the menu
      // stays short no matter how many folders exist.
      { icon: 'folder', label: 'Move to folder…', onSelect: () => setMoveFeed(feed) },
      { icon: 'folderPlus', label: 'New folder…', onSelect: () => beginCreateFolder(feed.id) },
      {
        icon: 'sliders',
        label: 'Manage sources…',
        onSelect: () => {
          onClose();
          onManageSources();
        },
      },
      { type: 'divider' },
      {
        icon: 'trash',
        label: 'Unsubscribe',
        danger: true,
        onSelect: () => onUnsubscribe(feed),
      },
    ];
  };

  const pickFolderForFeed = (folder: string | undefined) => {
    const feed = moveFeed;
    setMoveFeed(null);
    if (!feed) return;
    const result = store.moveFeedToFolder(feed.id, folder);
    if (!result.ok) {
      store.notify('error', result.message ?? 'Could not move that feed.');
      return;
    }
    store.notify(
      'success',
      folder ? `Moved “${feed.title}” to “${folder}”` : `Removed “${feed.title}” from its folder`
    );
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
      {
        icon: 'sliders',
        label: 'Manage groups…',
        onSelect: () => {
          onClose();
          onManageGroups();
        },
      },
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
      { icon: 'refresh', label: 'Refresh all feeds', onSelect: () => void store.refreshAll({ force: true }) },
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
   * Reveal: scroll a feed or folder row into view. Expanding the path is
   * opt-in (`expand = true`) and only used by the explicit "Reveal active
   * feed" button: plain navigation must never open a collapsed folder.
   */
  const revealRow = (selector: string, folderName?: string, expand = false) => {
    if (expand && folderName && isCollapsed(folderName)) {
      setFolderCollapsed(folderName, false);
    }
    requestAnimationFrame(() => {
      navRef.current?.querySelector(selector)?.scrollIntoView({ block: 'nearest' });
    });
  };

  const revealFeed = (feedId: string, expand = false) => {
    const folderName = folders.find((f) => f.feeds.some((feed) => feed.id === feedId))?.name;
    revealRow(`[data-feed-id="${CSS.escape(feedId)}"]`, folderName, expand);
  };

  const revealFolder = (name: string, expand = false) => {
    revealRow(`[data-folder-name="${CSS.escape(name)}"]`, name, expand);
  };

  /** What "reveal" targets right now: the open article's feed, else the
   *  active filter (a feed, a folder view, or nothing for "All articles"). */
  const revealActiveTarget = (expand = false) => {
    const article = state.ui.activeArticleId
      ? Object.values(state.articles)
          .flat()
          .find((a) => a.id === state.ui.activeArticleId)
      : null;
    if (article) {
      revealFeed(article.feedId, expand);
      return;
    }
    const folderName = folderNameFromViewId(state.ui.activeFeedId);
    if (folderName) {
      revealFolder(folderName, expand);
      return;
    }
    if (state.ui.activeFeedId && state.ui.activeFeedId !== ALL_FEEDS) {
      revealFeed(state.ui.activeFeedId, expand);
    }
  };

  // Automatic: keep the active row visible, but never change what is
  // collapsed/expanded — that is the caret's job.
  useEffect(() => {
    revealActiveTarget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ui.activeArticleId, state.ui.activeFeedId]);

  const menuAtButton = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom + 4 };
  };

  const renderFeedItem = (feed: Feed) => (
    <FeedItem
      key={feed.id}
      feed={feed}
      unread={unreadCount(state, feed.id)}
      feedState={state.feedState[feed.id]}
      isActive={state.ui.activeFeedId === feed.id}
      isRenaming={renamingFeedId === feed.id}
      renameValue={renameFeedValue}
      renameRef={renameFeedRef}
      onSelect={() => selectFeed(feed.id)}
      onRenameChange={setRenameFeedValue}
      onRenameKey={onRenameFeedKey}
      onRenameBlur={submitRenameFeed}
      onMenu={(target, x, y) => setContextMenu({ type: 'feed', feed: target, x, y })}
      onUnsubscribe={onUnsubscribe}
    />
  );

  return (
    <nav
      className={`sidebar ${isResizing ? 'sidebar--resizing' : ''}`}
      aria-label="Feeds"
      ref={navRef}
      style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
    >
      <SidebarHeader searchRef={searchRef} onSearchKey={onSearchKey} onClose={onClose} />
      <SidebarToolbar
        onNewFolder={() => beginCreateFolder()}
        onAddFeed={onAddFeed}
        hasFolders={folders.length > 0}
        anyFolderOpen={anyFolderOpen}
        onToggleFolders={toggleAllFolders}
        onReveal={() => revealActiveTarget(true)}
      />

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
                  className={`folder-header${isActive ? ' is-active' : ''}`}
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
                    <>
                      <button
                        type="button"
                        className="folder-row__toggle"
                        onClick={() => setFolderCollapsed(folder.name, isOpen)}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? 'Collapse' : 'Expand'} folder ${folder.name}`}
                        title={isOpen ? `Collapse “${folder.name}”` : `Expand “${folder.name}”`}
                      >
                        <Icon
                          name="chevronDown"
                          size={14}
                          className={`folder-row__caret ${isOpen ? '' : 'caret--collapsed'}`}
                        />
                      </button>
                      <button
                        type="button"
                        className={`feed-row folder-row ${isActive ? 'is-active' : ''}`}
                        onClick={() => openFolder(folder.name)}
                        aria-current={isActive ? 'page' : undefined}
                        title={`Show articles from “${folder.name}”`}
                      >
                        <Icon name="folder" size={15} className="folder-row__icon" />
                        <span className="feed-row__title">{folder.name}</span>
                        {folderUnread > 0 && (
                          <span className="badge">{folderUnread > 999 ? '999+' : folderUnread}</span>
                        )}
                      </button>
                    </>
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

      <CreateFolderDialog
        open={creatingFolder}
        feedTitle={state.feeds.find((feed) => feed.id === moveAfterCreate)?.title}
        onClose={cancelCreateFolder}
        onCreate={createFolder}
      />

      <FolderPickerDialog
        open={moveFeed !== null}
        title={moveFeed ? `Move “${moveFeed.title}” to…` : 'Move to folder'}
        folders={folders.map((folder) => folder.name)}
        current={moveFeed?.folder?.trim() || undefined}
        onClose={() => setMoveFeed(null)}
        onPick={pickFolderForFeed}
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
