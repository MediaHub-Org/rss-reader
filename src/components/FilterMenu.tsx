import type { ArticleFilter } from '../types';
import { store } from '../store/store';
import { useStore } from '../hooks/useStore';
import { usePopover } from '../hooks/usePopover';
import { Icon } from './Icon';
import { t } from '../lib/i18n';

const FILTERS: Array<{
  value: ArticleFilter;
  label: string;
  icon: 'inbox' | 'eye' | 'star';
}> = [
  { value: 'all', label: 'All articles', icon: 'inbox' },
  { value: 'unread', label: 'Unread only', icon: 'eye' },
  { value: 'starred', label: 'Starred only', icon: 'star' },
];

/** Top-bar article filter, kept separate from the layout selector. */
export function FilterMenu() {
  const state = useStore();
  const { open, toggle, close, rootRef, triggerRef } = usePopover();
  const filter = FILTERS.find((entry) => entry.value === state.prefs.articleFilter) ?? FILTERS[0];

  return (
    <div className="view-menu-root" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="topbar-tool topbar__filter"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('Filter')}: ${t(filter.label)}`}
        title={`${t('Filter')}: ${t(filter.label)}`}
      >
        <Icon name={filter.icon} size={18} />
        <span className="topbar-tool__label">{t(filter.label)}</span>
        <Icon name="chevronDown" size={12} className="topbar-tool__caret" />
      </button>

      {open && (
        <div className="view-menu filter-menu" role="menu" aria-label={t('Article filter')}>
          <p className="view-menu__section">{t('Show')}</p>
          {FILTERS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              role="menuitemradio"
              aria-checked={state.prefs.articleFilter === entry.value}
              className="view-menu__item"
              onClick={() => {
                store.setPreferences({ articleFilter: entry.value });
                close();
              }}
            >
              <span className="view-menu__check">
                {state.prefs.articleFilter === entry.value && <Icon name="check" size={15} />}
              </span>
              <Icon name={entry.icon} size={16} className="view-menu__icon" />
              <span>{t(entry.label)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
