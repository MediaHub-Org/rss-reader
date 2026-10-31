import type { RefObject } from 'react';
import { store } from '../../store/store';
import { useStore } from '../../hooks/useStore';
import { Icon } from '../Icon';
import { SearchOptions } from '../SearchOptions';
import { t } from '../../lib/i18n';

interface SidebarHeaderProps {
  searchRef: RefObject<HTMLInputElement>;
  onSearchKey: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onClose: () => void;
}

/** Brand, search field and search scope/options for the feed sidebar. */
export function SidebarHeader({ searchRef, onSearchKey, onClose }: SidebarHeaderProps) {
  const state = useStore();

  return (
    <>
      <div className="sidebar__header">
        <span className="brand" title={t('RSS Reader')} aria-label={t('RSS Reader')}>
          <Icon name="rss" size={18} />
        </span>
        <button
          type="button"
          className="icon-button sidebar__close"
          onClick={onClose}
          aria-label={t('Close feed list')}
        >
          <Icon name="close" />
        </button>
      </div>

      <div className="sidebar__search">
        <Icon name="search" size={16} className="search__icon" />
        <input
          ref={searchRef}
          type="search"
          className="search__input"
          placeholder={t('Search articles (full text)')}
          aria-label={t('Search articles')}
          value={state.ui.query}
          onChange={(event) => store.setQuery(event.target.value)}
          onKeyDown={onSearchKey}
          spellCheck={false}
        />
        <button
          type="button"
          className={`search__scope ${state.ui.searchAllFeeds ? 'is-active' : ''}`}
          aria-pressed={state.ui.searchAllFeeds}
          aria-label={t(
            state.ui.searchAllFeeds
              ? 'Search current view instead of all feeds'
              : 'Search all feeds instead of the current view'
          )}
          title={t(
            state.ui.searchAllFeeds
              ? 'Searching all feeds — click for current view'
              : 'Searching current view — click for all feeds'
          )}
          onClick={() => store.setSearchAllFeeds(!state.ui.searchAllFeeds)}
        >
          {t(state.ui.searchAllFeeds ? 'All' : 'View')}
        </button>
        <SearchOptions />
      </div>
    </>
  );
}
