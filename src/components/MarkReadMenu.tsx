import { store } from '../store/store';
import { useStore } from '../hooks/useStore';
import { usePopover } from '../hooks/usePopover';
import { useVisibleArticles } from '../hooks/useVisibleArticles';
import { countLabel } from '../lib/format';
import { articlesToMarkRead } from '../lib/markRead';
import { Icon } from './Icon';
import { t } from '../lib/i18n';

const OPTIONS: Array<{ days: number; label: string }> = [
  { days: 0, label: 'All articles' },
  { days: 1, label: 'Older than 1 day' },
  { days: 3, label: 'Older than 3 days' },
  { days: 7, label: 'Older than 7 days' },
];

/** Split control: the check button marks the visible list; the caret offers date cutoffs. */
export function MarkReadMenu() {
  const state = useStore();
  const { open, toggle, close, rootRef, triggerRef } = usePopover();
  const visible = useVisibleArticles(state);

  const mark = (days: number) => {
    const ids = articlesToMarkRead(visible, state.readIds, days);
    if (!ids.length) {
      store.notify('info', 'Nothing to mark as read');
    } else {
      store.setRead(ids, true);
      store.notify('success', `Marked ${countLabel(ids.length, 'article')} as read`);
    }
    close();
  };

  const unread = visible.filter((article) => !state.readIds[article.id]).length;

  return (
    <div className="mark-read" ref={rootRef}>
      <button
        type="button"
        className="icon-button"
        onClick={() => mark(0)}
        disabled={!unread}
        aria-label={t('Mark all visible articles as read')}
        title={t('Mark all visible as read')}
      >
        <Icon name="check" />
      </button>
      <button
        type="button"
        ref={triggerRef}
        className="icon-button mark-read__caret"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('Mark as read options')}
        title={t('Mark as read…')}
      >
        <Icon name="chevronDown" size={13} />
      </button>

      {open && (
        <div className="view-menu mark-read__menu" role="menu" aria-label={t('Mark as read')}>
          <p className="view-menu__section">{t('Mark as read')}</p>
          {OPTIONS.map((option) => (
            <button
              key={option.days}
              type="button"
              role="menuitem"
              className="view-menu__item view-menu__item--plain"
              onClick={() => mark(option.days)}
            >
              {t(option.label)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
