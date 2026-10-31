import type { SortMode } from '../types';
import { store } from '../store/store';
import { useStore } from '../hooks/useStore';
import { usePopover } from '../hooks/usePopover';
import { Icon } from './Icon';

const SORTS: Array<{
  value: SortMode;
  label: string;
  icon: 'clock' | 'sort' | 'rss';
}> = [
  { value: 'date-desc', label: 'Newest first', icon: 'clock' },
  { value: 'date-asc', label: 'Oldest first', icon: 'clock' },
  { value: 'feed', label: 'By feed name', icon: 'rss' },
];

/** Top-bar sort selector, visually identical to View and Filter. */
export function SortMenu() {
  const state = useStore();
  const { open, toggle, close, rootRef, triggerRef } = usePopover();
  const sort = SORTS.find((entry) => entry.value === state.ui.sort) ?? SORTS[0];

  return (
    <div className="view-menu-root" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="topbar-tool topbar__sort"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Sort: ${sort.label}`}
        title={`Sort: ${sort.label}`}
      >
        <Icon name="sort" size={18} />
        <span className="topbar-tool__label">{sort.label}</span>
        <Icon name="chevronDown" size={12} className="topbar-tool__caret" />
      </button>

      {open && (
        <div className="view-menu sort-menu" role="menu" aria-label="Sort articles">
          <p className="view-menu__section">Sort</p>
          {SORTS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              role="menuitemradio"
              aria-checked={state.ui.sort === entry.value}
              className="view-menu__item"
              onClick={() => {
                store.setSort(entry.value);
                close();
              }}
            >
              <span className="view-menu__check">
                {state.ui.sort === entry.value && <Icon name="check" size={15} />}
              </span>
              <Icon name={entry.icon} size={16} className="view-menu__icon" />
              <span>{entry.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
