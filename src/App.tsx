import { useEffect, useMemo, useRef, useState } from 'react';
import type { Feed } from './types';
import { store, selectArticles, unreadCount } from './store/store';
import { useStore } from './hooks/useStore';
import { useViewHistory } from './hooks/useViewHistory';
import { leaveArticle } from './lib/viewHistory';
import { isDesktopApp } from './lib/desktop';
import { syncDesktopSettings, updateTrayUnread } from './lib/desktopSettings';
import { listenForTrayRefresh } from './lib/trayEvents';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { ArticleList } from './components/ArticleList';
import { ArticleDetail } from './components/ArticleDetail';
import { AddFeedDialog } from './components/AddFeedDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { DataDialog, type DataTab } from './components/DataDialog';
import { BackupsDialog } from './components/BackupsDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Toasts } from './components/Toasts';
import { AUTO_BACKUP_CHECK_MS, maybeAutoBackup } from './lib/backups';

const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const STALE_AFTER_MS = 10 * 60 * 1000;

export default function App() {
  const state = useStore();
  const [addOpen, setAddOpen] = useState(false);
  const [addFolder, setAddFolder] = useState<string | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [dataTab, setDataTab] = useState<DataTab>('import');
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [confirmFeed, setConfirmFeed] = useState<Feed | null>(null);
  const [confirmFolder, setConfirmFolder] = useState<string | null>(null);
  const lastRefreshed = useRef(0);

  /* back/forward mouse buttons, Alt+← and the browser gestures */
  useViewHistory(state.ui.activeFeedId, state.ui.activeArticleId);

  /* hydrate once */
  useEffect(() => {
    void store.hydrate();
  }, []);

  /* daily desktop snapshots: at launch (after the cache hydrates), then checked periodically */
  useEffect(() => {
    if (!state.hydrated) return;
    void maybeAutoBackup();
    const timer = setInterval(() => void maybeAutoBackup(), AUTO_BACKUP_CHECK_MS);
    return () => clearInterval(timer);
  }, [state.hydrated]);

  /* After adding/importing feeds, give the article cache a moment to settle,
     then take the first snapshot if none exists yet. */
  useEffect(() => {
    if (!state.hydrated || state.feeds.length === 0) return;
    const timer = setTimeout(() => void maybeAutoBackup(), 30_000);
    return () => clearTimeout(timer);
  }, [state.hydrated, state.feeds.length]);

  /* periodic refresh: paused while the tab is hidden in the browser, but the
     desktop shell keeps running in the tray */
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible' && !isDesktopApp()) return;
      if (Date.now() - lastRefreshed.current < STALE_AFTER_MS) return;
      lastRefreshed.current = Date.now();
      void store.refreshAll({ silent: true, notify: true });
    };
    const timer = setInterval(tick, REFRESH_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const totalUnread = useMemo(
    () => state.feeds.reduce((sum, feed) => sum + unreadCount(state, feed.id), 0),
    [state]
  );

  /* Opening or switching an article starts at the top of the reading pane,
     even when the pane element itself stays mounted in the split layout. */
  useEffect(() => {
    if (!state.ui.activeArticleId) return;
    const pane = document.querySelector<HTMLElement>(
      '.content-area__detail, .content-area'
    );
    pane?.scrollTo({ top: 0 });
  }, [state.ui.activeArticleId]);

  /* desktop tray: close-to-tray preference, login item, unread tooltip and
     the tray's "Refresh feeds" action */
  useEffect(() => {
    if (!state.hydrated) return;
    void syncDesktopSettings(state.prefs);
    // Preferences are synced once after hydration; individual toggles call
    // the native helpers directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.hydrated]);

  useEffect(() => {
    if (!state.hydrated) return;
    void updateTrayUnread(totalUnread);
  }, [state.hydrated, totalUnread]);

  useEffect(() => {
    if (!state.hydrated) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listenForTrayRefresh(() => {
      void store.refreshAll({ force: true, notify: true });
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [state.hydrated]);

  const visibleArticles = useMemo(
    () =>
      selectArticles(state, {
        feedId: state.ui.activeFeedId,
        sort: state.ui.sort,
        query: state.ui.query,
        hideRead: state.prefs.hideRead,
        searchAll: state.ui.searchAllFeeds,
      }),
    [state]
  );

  /* keyboard navigation */
  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el || !el.tagName) return false;
      return (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;

      const activeId = state.ui.activeArticleId;
      const index = activeId ? visibleArticles.findIndex((a) => a.id === activeId) : -1;
      const openArticle = (id: string) => {
        store.setActiveArticle(id);
        const article = visibleArticles.find((a) => a.id === id);
        if (article && !state.readIds[id]) store.toggleRead(id);
        requestAnimationFrame(() => {
          document
            .querySelector(`[data-article-id="${CSS.escape(id)}"]`)
            ?.scrollIntoView({ block: 'nearest' });
        });
      };

      switch (event.key) {
        case 'j':
        case 'ArrowDown': {
          if (!visibleArticles.length) return;
          event.preventDefault();
          const next = visibleArticles[Math.min(index + 1, visibleArticles.length - 1)];
          if (index < 0) openArticle(visibleArticles[0].id);
          else openArticle(next.id);
          break;
        }
        case 'k':
        case 'ArrowUp': {
          if (!visibleArticles.length) return;
          event.preventDefault();
          if (index <= 0) {
            // Only close an article. With no article open this key is a no-op:
            // it must not walk the browser history backwards.
            if (activeId) leaveArticle();
            return;
          }
          openArticle(visibleArticles[index - 1].id);
          break;
        }
        case 'Enter':
        case 'o': {
          if (activeId) {
            event.preventDefault();
            openArticle(activeId);
          } else if (visibleArticles[0]) {
            openArticle(visibleArticles[0].id);
          }
          break;
        }
        case 'm': {
          if (activeId) store.toggleRead(activeId);
          break;
        }
        case 'r': {
          event.preventDefault();
          void store.refreshAll({ force: true });
          break;
        }
        case '/': {
          event.preventDefault();
          document.querySelector<HTMLInputElement>('.search__input')?.focus();
          break;
        }
        case 'a': {
          event.preventDefault();
          setAddFolder(undefined);
          setAddOpen(true);
          break;
        }
        case 'Escape': {
          if (state.ui.activeArticleId) leaveArticle();
          else if (state.ui.sidebarOpen) store.setSidebarOpen(false);
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state, visibleArticles]);

  const closeSidebar = () => store.setSidebarOpen(false);

  return (
    <div
      className="app"
      data-sidebar-open={state.ui.sidebarOpen}
      data-sidebar-collapsed={state.prefs.sidebarCollapsed}
      data-article-open={Boolean(state.ui.activeArticleId)}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <div className="app__body">
        <Sidebar
          onAddFeed={() => {
            setAddFolder(undefined);
            setAddOpen(true);
          }}
          onAddFeedInFolder={(folder) => {
            setAddFolder(folder);
            setAddOpen(true);
          }}
          onUnsubscribe={setConfirmFeed}
          onRemoveFolder={setConfirmFolder}
          onClose={closeSidebar}
        />

        {state.ui.sidebarOpen && (
          <div className="backdrop" onClick={closeSidebar} aria-hidden="true" />
        )}

        <div className="main">
          <TopBar
            onMenu={() => store.setSidebarOpen(true)}
            onSettings={() => setSettingsOpen(true)}
          />

          <main
            className={`content-area ${state.ui.activeArticleId ? 'content-area--split' : ''}`}
            id="main-content"
            tabIndex={-1}
          >
            <div className="content-area__list">
              <ArticleList onAddFeed={() => setAddOpen(true)} onImport={() => setDataOpen(true)} />
            </div>
            {state.ui.activeArticleId && (
              <div className="content-area__detail">
                <ArticleDetail />
              </div>
            )}
          </main>
        </div>
      </div>

      <AddFeedDialog
        open={addOpen}
        initialFolder={addFolder}
        onClose={() => {
          setAddOpen(false);
          setAddFolder(undefined);
        }}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        hasFeeds={state.feeds.length > 0}
        onImport={() => {
          // Hand off to the Data dialog instead of stacking it on top of
          // Settings -- two simultaneously open Dialogs both listen for
          // Escape on document, and only one of them ends up closing.
          setSettingsOpen(false);
          setDataTab('import');
          setDataOpen(true);
        }}
        onExport={() => {
          setSettingsOpen(false);
          setDataTab('export');
          setDataOpen(true);
        }}
        onManage={() => {
          setSettingsOpen(false);
          setDataTab('manage');
          setDataOpen(true);
        }}
        onBackups={() => {
          setSettingsOpen(false);
          setBackupsOpen(true);
        }}
      />
      <DataDialog open={dataOpen} initialTab={dataTab} onClose={() => setDataOpen(false)} />
      <BackupsDialog open={backupsOpen} onClose={() => setBackupsOpen(false)} />

      <ConfirmDialog
        open={Boolean(confirmFeed)}
        title="Unsubscribe?"
        message={`“${confirmFeed?.title ?? ''}” will be removed from your feed list along with its cached articles. Your read history for other feeds is unaffected.`}
        confirmLabel="Unsubscribe"
        onConfirm={() => {
          if (confirmFeed) store.removeFeed(confirmFeed.id);
          setConfirmFeed(null);
        }}
        onCancel={() => setConfirmFeed(null)}
      />

      <ConfirmDialog
        open={Boolean(confirmFolder)}
        title="Delete folder?"
        message={`Folder “${confirmFolder ?? ''}” and all feeds inside it will be removed along with their cached articles.`}
        confirmLabel="Delete folder"
        onConfirm={() => {
          if (confirmFolder) store.removeFolder(confirmFolder);
          setConfirmFolder(null);
        }}
        onCancel={() => setConfirmFolder(null)}
      />

      <Toasts />
    </div>
  );
}
