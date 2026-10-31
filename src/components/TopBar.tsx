import { folderNameFromViewId } from '../types';
import { store } from '../store/store';
import { useStore } from '../hooks/useStore';
import { useVisibleArticles } from '../hooks/useVisibleArticles';
import { plural, t } from '../lib/i18n';
import { formatDate, formatRelativeTime } from '../lib/format';
import { lastUpdatedAt } from '../lib/feedStatus';
import { Icon } from './Icon';
import { ViewMenu } from './ViewMenu';
import { FilterMenu } from './FilterMenu';
import { SortMenu } from './SortMenu';
import { MarkReadMenu } from './MarkReadMenu';

interface TopBarProps {
  onMenu: () => void;
  onSettings: () => void;
}

export function TopBar({ onMenu, onSettings }: TopBarProps) {
  const state = useStore();

  const activeFeed = state.feeds.find((f) => f.id === state.ui.activeFeedId);
  const activeFolder = folderNameFromViewId(state.ui.activeFeedId);
  const heading = activeFolder ?? activeFeed?.title ?? t('All articles');

  const visible = useVisibleArticles(state);

  const unreadInView = visible.reduce((sum, a) => (state.readIds[a.id] ? sum : sum + 1), 0);
  const anyLoading = Object.values(state.feedState).some((f) => f.status === 'loading');
  const updatedAt = lastUpdatedAt(state.feedState);

  return (
    <header className="topbar">
      <button type="button" className="icon-button topbar__menu" onClick={onMenu} aria-label={t('Show feed list')}>
        <Icon name="menu" />
      </button>

      <button
        type="button"
        className="icon-button topbar__sidebar-toggle"
        onClick={() => store.setPreferences({ sidebarCollapsed: !state.prefs.sidebarCollapsed })}
        aria-label={t(state.prefs.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar')}
        title={t(state.prefs.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar')}
      >
        <Icon name="panelLeft" size={17} />
      </button>

      <div className="topbar__titles">
        <h1 className="topbar__heading" title={activeFeed?.description}>
          {heading}
        </h1>
        <p className="topbar__meta">
          {plural(visible.length, '{count} article', '{count} articles')}
          {unreadInView > 0 && (
            <span className="topbar__unread">
              {` · ${plural(unreadInView, '{count} unread', '{count} unread')}`}
            </span>
          )}
          {state.ui.query && state.ui.searchAllFeeds ? ` · ${t('all feeds')}` : ''}
          {updatedAt > 0 && (
            <span className="topbar__updated" title={formatDate(updatedAt)}>
              {` · ${t('Updated {time}', { time: formatRelativeTime(updatedAt) })}`}
            </span>
          )}
        </p>
      </div>

      <div className="topbar__tools">
        <button
          type="button"
          className="icon-button"
          onClick={() => void store.refreshAll({ force: true })}
          disabled={anyLoading || !state.feeds.length}
          aria-label={t('Refresh all feeds')}
          title={`${t('Refresh all feeds')} (R)`}
        >
          <Icon name="refresh" className={anyLoading ? 'spin' : undefined} />
        </button>

        <MarkReadMenu />

        <ViewMenu />
        <FilterMenu />

        <SortMenu />

        <button
          type="button"
          className="icon-button"
          onClick={onSettings}
          aria-label={t('Settings')}
          title={t('Settings')}
        >
          <Icon name="settings" size={17} />
        </button>
      </div>
    </header>
  );
}
