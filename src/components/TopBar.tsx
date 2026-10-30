import { useMemo } from 'react';
import type { SortMode } from '../types';
import { folderNameFromViewId } from '../types';
import { store, selectArticles } from '../store/store';
import { useStore } from '../hooks/useStore';
import { Icon } from './Icon';
import { Dropdown } from './Dropdown';
import { ViewMenu } from './ViewMenu';
import { FilterMenu } from './FilterMenu';
import { MarkReadMenu } from './MarkReadMenu';

interface TopBarProps {
  onMenu: () => void;
  onSettings: () => void;
}

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: 'date-desc', label: 'Newest first' },
  { value: 'date-asc', label: 'Oldest first' },
  { value: 'feed', label: 'By feed name' },
];

export function TopBar({ onMenu, onSettings }: TopBarProps) {
  const state = useStore();

  const activeFeed = state.feeds.find((f) => f.id === state.ui.activeFeedId);
  const activeFolder = folderNameFromViewId(state.ui.activeFeedId);
  const heading = activeFolder ?? activeFeed?.title ?? 'All articles';

  const visible = useMemo(
    () =>
      selectArticles(state, {
        feedId: state.ui.activeFeedId,
        sort: state.ui.sort,
        query: state.ui.query,
        filter: state.prefs.articleFilter,
        caseSensitive: state.prefs.searchCaseSensitive,
        fullText: state.prefs.searchFullText,
        searchAll: state.ui.searchAllFeeds,
      }),
    [state]
  );

  const unreadInView = visible.reduce((sum, a) => (state.readIds[a.id] ? sum : sum + 1), 0);
  const anyLoading = Object.values(state.feedState).some((f) => f.status === 'loading');

  return (
    <header className="topbar">
      <button type="button" className="icon-button topbar__menu" onClick={onMenu} aria-label="Show feed list">
        <Icon name="menu" />
      </button>

      <button
        type="button"
        className="icon-button topbar__sidebar-toggle"
        onClick={() => store.setPreferences({ sidebarCollapsed: !state.prefs.sidebarCollapsed })}
        aria-label={state.prefs.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        title={state.prefs.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
      >
        <Icon name="panelLeft" size={17} />
      </button>

      <div className="topbar__titles">
        <h1 className="topbar__heading" title={activeFeed?.description}>
          {heading}
        </h1>
        <p className="topbar__meta">
          {visible.length} {visible.length === 1 ? 'article' : 'articles'}
          {unreadInView > 0 ? ` · ${unreadInView} unread` : ''}
          {state.ui.query && state.ui.searchAllFeeds ? ' · all feeds' : ''}
        </p>
      </div>

      <div className="topbar__tools">
        <button
          type="button"
          className="icon-button"
          onClick={() => void store.refreshAll({ force: true })}
          disabled={anyLoading || !state.feeds.length}
          aria-label="Refresh all feeds"
          title="Refresh all feeds (R)"
        >
          <Icon name="refresh" className={anyLoading ? 'spin' : undefined} />
        </button>

        <ViewMenu />
        <FilterMenu />

        <Dropdown<SortMode>
          value={state.ui.sort}
          options={SORT_OPTIONS}
          onChange={(next) => store.setSort(next)}
          label="Sort articles"
          triggerTitle="Sort articles"
          icon={<Icon name="sort" size={15} />}
          className="topbar__sort"
        />

        <MarkReadMenu />

        <button
          type="button"
          className="icon-button"
          onClick={onSettings}
          aria-label="Settings"
          title="Settings"
        >
          <Icon name="settings" size={17} />
        </button>
      </div>
    </header>
  );
}
