import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { Feed } from './types';
import { isDarkTheme, store, unreadCount } from './store/store';
import { useStore } from './hooks/useStore';
import { useVisibleArticles } from './hooks/useVisibleArticles';
import { useViewHistory } from './hooks/useViewHistory';
import { leaveArticle } from './lib/viewHistory';
import { isTauriApp } from './lib/desktop';
import { syncDesktopSettings, syncWindowTheme, updateTrayUnread } from './lib/desktopSettings';
import { listenForTrayRefresh } from './lib/trayEvents';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { ArticleList } from './components/ArticleList';
import { ArticleDetail } from './components/ArticleDetail';
import { ArticleOverlay } from './components/ArticleOverlay';
import { AddFeedDialog } from './components/AddFeedDialog';
import type { SettingsSection } from './components/SettingsDialog';
import type { DataTab } from './components/DataDialog';
import type { ManageTab } from './components/settings/ManagePanel';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Toasts } from './components/Toasts';
import { AUTO_BACKUP_CHECK_MS, maybeAutoBackup } from './lib/backups';
import { t } from './lib/i18n';

const SettingsDialog = lazy(() =>
  import('./components/SettingsDialog').then((module) => ({ default: module.SettingsDialog }))
);
const DataDialog = lazy(() =>
  import('./components/DataDialog').then((module) => ({ default: module.DataDialog }))
);
const BackupsDialog = lazy(() =>
  import('./components/BackupsDialog').then((module) => ({ default: module.BackupsDialog }))
);

const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const STALE_AFTER_MS = 10 * 60 * 1000;

export default function App() {
  const state = useStore();
  const [addOpen, setAddOpen] = useState(false);
  const [addFolder, setAddFolder] = useState<string | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('preferences');
  const [manageTab, setManageTab] = useState<ManageTab>('sources');
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
      if (document.visibilityState !== 'visible' && !isTauriApp()) return;
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
     even when the pane element itself stays mounted in the split/overlay. */
  useEffect(() => {
    if (!state.ui.activeArticleId) return;
    const pane = document.querySelector<HTMLElement>(
      '.article-overlay__dialog, .content-area__detail, .content-area'
    );
    pane?.scrollTo({ top: 0 });
  }, [state.ui.activeArticleId]);

  /* desktop tray: close-to-tray preference, login item, unread tooltip and
     the tray's "Refresh feeds" action */
  useEffect(() => {
    if (!state.hydrated) return;
    void syncWindowTheme(isDarkTheme(state.prefs));
  }, [state.hydrated, state.prefs.theme]);

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

  const visibleArticles = useVisibleArticles(state);

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
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
      const overlayOnly =
        dialogs.length === 1 && dialogs[0].classList.contains('article-overlay__dialog');
      if (dialogs.length && !overlayOnly) return;
      if (
        overlayOnly &&
        !['j', 'k', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'm'].includes(event.key)
      ) {
        return;
      }

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
        case 'ArrowLeft': {
          if (index > 0) {
            event.preventDefault();
            openArticle(visibleArticles[index - 1].id);
          }
          break;
        }
        case 'ArrowRight': {
          if (index >= 0 && index < visibleArticles.length - 1) {
            event.preventDefault();
            openArticle(visibleArticles[index + 1].id);
          }
          break;
        }
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
  const openSettings = (section: SettingsSection = 'preferences', tab?: ManageTab) => {
    setSettingsSection(section);
    if (tab) setManageTab(tab);
    setSettingsOpen(true);
  };
  /* Card and magazine views open the reader as an overlay; list and compact
     keep the wide two-pane layout. */
  const cardOverlay =
    Boolean(state.ui.activeArticleId) &&
    (state.prefs.viewMode === 'card' || state.prefs.viewMode === 'magazine');

  return (
    <div
      className="app"
      data-sidebar-open={state.ui.sidebarOpen}
      data-sidebar-collapsed={state.prefs.sidebarCollapsed}
      data-article-open={Boolean(state.ui.activeArticleId)}
    >
      <a className="skip-link" href="#main-content">
        {t('Skip to content')}
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
          onManageGroups={() => openSettings('manage', 'groups')}
          onClose={closeSidebar}
        />

        {state.ui.sidebarOpen && (
          <div className="backdrop" onClick={closeSidebar} aria-hidden="true" />
        )}

        <div className="main">
          <TopBar
            onMenu={() => store.setSidebarOpen(true)}
            onSettings={() => openSettings('preferences')}
          />

          <main
            className={`content-area ${
              state.ui.activeArticleId && !cardOverlay ? 'content-area--split' : ''
            }`}
            id="main-content"
            tabIndex={-1}
          >
            <div className="content-area__list">
              <ArticleList onAddFeed={() => setAddOpen(true)} onImport={() => setDataOpen(true)} />
            </div>
            {state.ui.activeArticleId && !cardOverlay && (
              <div className="content-area__detail">
                <ArticleDetail />
              </div>
            )}
          </main>
        </div>
      </div>

      {cardOverlay && <ArticleOverlay />}

      <AddFeedDialog
        open={addOpen}
        initialFolder={addFolder}
        onClose={() => {
          setAddOpen(false);
          setAddFolder(undefined);
        }}
      />
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog
            open
            onClose={() => setSettingsOpen(false)}
            hasFeeds={state.feeds.length > 0}
            initialSection={settingsSection}
            initialManageTab={manageTab}
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
            onBackups={() => {
              setSettingsOpen(false);
              setBackupsOpen(true);
            }}
          />
        </Suspense>
      )}

      {dataOpen && (
        <Suspense fallback={null}>
          <DataDialog open initialTab={dataTab} onClose={() => setDataOpen(false)} />
        </Suspense>
      )}
      {backupsOpen && (
        <Suspense fallback={null}>
          <BackupsDialog open onClose={() => setBackupsOpen(false)} />
        </Suspense>
      )}

      <ConfirmDialog
        open={Boolean(confirmFeed)}
        title={t('Unsubscribe?')}
        message={t(
          '“{name}” will be removed from your feed list along with its cached articles. Your read history for other feeds is unaffected.',
          { name: confirmFeed?.title ?? '' }
        )}
        confirmLabel={t('Unsubscribe')}
        onConfirm={() => {
          if (confirmFeed) store.removeFeed(confirmFeed.id);
          setConfirmFeed(null);
        }}
        onCancel={() => setConfirmFeed(null)}
      />

      <ConfirmDialog
        open={Boolean(confirmFolder)}
        title={t('Delete folder?')}
        message={t(
          'Folder “{name}” and all feeds inside it will be removed along with their cached articles.',
          { name: confirmFolder ?? '' }
        )}
        confirmLabel={t('Delete folder')}
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
