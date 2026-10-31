import type { RefObject } from 'react';
import { store } from '../../store/store';
import { useStore } from '../../hooks/useStore';
import { Icon } from '../Icon';
import { SearchOptions } from '../SearchOptions';
import { t } from '../../lib/i18n';

interface SidebarHeaderProps {
  searchRef: RefObject<HTMLInputElement | null>;
  onSearchKey: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onClose: () => void;
}

/** Search field, scope and options for the feed sidebar. */
export function SidebarHeader({ searchRef, onSearchKey, onClose }: SidebarHeaderProps) {
  const state = useStore();

  return (
    <>
      {/* The app identity lives in the window title and About; the sidebar
          starts with search instead of a logo row. The close button only
          exists for the mobile drawer. */}
      <div className="sidebar__header">
        <button
          type="button"
          className="icon-button sidebar__close"
          onClick={onClose}
          aria-label={t('Close feed list')}
        >
          <Icon name="close" />
        </button>
      </div>

      <div className="sidebar__search" role="search">
        <Icon name="search" size={16} className="search__icon" />
        <input
          ref={searchRef}
          type="text"
          inputMode="search"
          enterKeyHint="search"
          className="search__input"
          placeholder={t(state.ui.searchAllFeeds ? 'Search all feeds' : 'Search articles')}
          aria-label={t('Search articles')}
          value={state.ui.query}
          onChange={(event) => store.setQuery(event.target.value)}
          onKeyDown={onSearchKey}
          spellCheck={false}
        />
        <SearchOptions />
      </div>
    </>
  );
}
