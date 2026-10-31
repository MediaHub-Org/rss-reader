import { store } from '../store/store';
import { useStore } from '../hooks/useStore';
import { usePopover } from '../hooks/usePopover';
import { Icon } from './Icon';
import { t } from '../lib/i18n';

/** Case/full-text options attached to the sidebar search field. */
export function SearchOptions() {
  const state = useStore();
  const { open, toggle, rootRef, triggerRef } = usePopover();

  return (
    <div className="search-options-root" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`search__options ${open ? 'is-active' : ''} ${
          state.ui.searchAllFeeds ||
          state.prefs.searchCaseSensitive ||
          !state.prefs.searchFullText ||
          state.prefs.searchRegex
            ? 'has-active'
            : ''
        }`}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('Search options')}
        title={t('Search options')}
      >
        <Icon name="sliders" size={15} />
      </button>

      {open && (
        <div className="search-options" role="menu" aria-label={t('Search options')}>
          <p className="view-menu__section">{t('Search')}</p>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={state.ui.searchAllFeeds}
            className="view-menu__item"
            onClick={() => store.setSearchAllFeeds(!state.ui.searchAllFeeds)}
          >
            <span className="view-menu__check">
              {state.ui.searchAllFeeds && <Icon name="check" size={15} />}
            </span>
            <span>{t('Search all feeds')}</span>
          </button>
          <div className="view-menu__divider" />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={state.prefs.searchCaseSensitive}
            className="view-menu__item"
            onClick={() =>
              store.setPreferences({
                searchCaseSensitive: !state.prefs.searchCaseSensitive,
              })
            }
          >
            <span className="view-menu__check">
              {state.prefs.searchCaseSensitive && <Icon name="check" size={15} />}
            </span>
            <span>{t('Case sensitive')}</span>
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={state.prefs.searchFullText}
            className="view-menu__item"
            onClick={() =>
              store.setPreferences({
                searchFullText: !state.prefs.searchFullText,
              })
            }
          >
            <span className="view-menu__check">
              {state.prefs.searchFullText && <Icon name="check" size={15} />}
            </span>
            <span>{t('Search in full text')}</span>
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={state.prefs.searchRegex}
            className="view-menu__item"
            onClick={() =>
              store.setPreferences({
                searchRegex: !state.prefs.searchRegex,
              })
            }
          >
            <span className="view-menu__check">
              {state.prefs.searchRegex && <Icon name="check" size={15} />}
            </span>
            <span>{t('Regular expression')}</span>
          </button>
        </div>
      )}
    </div>
  );
}
