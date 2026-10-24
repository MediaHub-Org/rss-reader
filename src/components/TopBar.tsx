import { useMemo, useRef } from 'react';
import type { SortMode } from '../types';
import { store, selectArticles, isDarkTheme } from '../store/store';
import { useStore } from '../hooks/useStore';
import { Icon } from './Icon';
import { Dropdown } from './Dropdown';

interface TopBarProps {
  onMenu: () => void;
  onAddFeed: () => void;
}

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: 'date-desc', label: 'Newest first' },
  { value: 'date-asc', label: 'Oldest first' },
  { value: 'feed', label: 'By feed name' },
];

export function TopBar({ onMenu, onAddFeed }: TopBarProps) {
  const state = useStore();
  const searchRef = useRef<HTMLInputElement>(null);

  const activeFeed = state.feeds.find((f) => f.id === state.ui.activeFeedId);
  const heading = activeFeed ? activeFeed.title : 'All articles';

  const visible = useMemo(
    () =>
      selectArticles(state, {
        feedId: state.ui.activeFeedId,
        sort: state.ui.sort,
        query: state.ui.query,
        hideRead: state.prefs.hideRead,
      }),
    [state]
  );

  const unreadInView = visible.reduce((sum, a) => (state.readIds[a.id] ? sum : sum + 1), 0);
  const anyLoading = Object.values(state.feedState).some((f) => f.status === 'loading');
  const dark = isDarkTheme(state.prefs);

  const onSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      store.setQuery('');
      searchRef.current?.blur();
    }
  };

  return (
    <header className="topbar">
      <button type="button" className="icon-button topbar__menu" onClick={onMenu} aria-label="Show feed list">
        <Icon name="menu" />
      </button>

      <div className="topbar__titles">
        <h1 className="topbar__heading" title={activeFeed?.description}>
          {heading}
        </h1>
        <p className="topbar__meta">
          {visible.length} {visible.length === 1 ? 'article' : 'articles'}
          {unreadInView > 0 ? ` · ${unreadInView} unread` : ''}
        </p>
      </div>

      <div className="topbar__tools">
        <div className="search">
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

        <Dropdown<SortMode>
          value={state.ui.sort}
          options={SORT_OPTIONS}
          onChange={(next) => store.setSort(next)}
          label="Sort articles"
          triggerTitle="Sort articles"
          icon={<Icon name="sort" size={15} />}
          className="topbar__sort"
        />

        <button
          type="button"
          className="icon-button"
          onClick={() => store.markAllRead(visible.map((a) => a.id))}
          disabled={!unreadInView}
          aria-label="Mark all visible articles as read"
          title="Mark all as read (all visible)"
        >
          <Icon name="check" />
        </button>

        <button
          type="button"
          className="icon-button"
          onClick={() => void store.refreshAll()}
          disabled={anyLoading || !state.feeds.length}
          aria-label="Refresh all feeds"
          title="Refresh all feeds (R)"
        >
          <Icon name="refresh" className={anyLoading ? 'spin' : undefined} />
        </button>

        <button
          type="button"
          className="icon-button"
          onClick={() => store.setPreferences({ theme: dark ? 'light' : 'dark' })}
          aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
          title={dark ? 'Light theme' : 'Dark theme'}
        >
          <Icon name={dark ? 'sun' : 'moon'} />
        </button>

        <button type="button" className="icon-button topbar__add" onClick={onAddFeed} aria-label="Add feed">
          <Icon name="plus" />
        </button>
      </div>
    </header>
  );
}
