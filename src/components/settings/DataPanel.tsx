import { useState } from 'react';
import { store } from '../../store/store';
import { clearArticleCache } from '../../lib/storage';
import { formatBytes } from '../../lib/format';
import { Icon } from '../Icon';
import { t } from '../../lib/i18n';

interface DataPanelProps {
  onImport: () => void;
  onExport: () => void;
  onBackups: () => void;
  hasFeeds: boolean;
  usage: { used: number };
}

/** Subscriptions, OPML/JSON transfer and local cache management. */
export function DataPanel({
  onImport,
  onExport,
  onBackups,
  hasFeeds,
  usage,
}: DataPanelProps) {
  const [clearing, setClearing] = useState(false);

  const clearCache = async () => {
    setClearing(true);
    await clearArticleCache();
    setClearing(false);
    store.notify('success', t('Article cache cleared'));
  };

  return (
    <>
      <section className="settings-section">
        <h2 className="settings-section__title">{t('Subscriptions & data')}</h2>
        <p className="settings-note settings-note--tight">
          {t('Import or export OPML, or move everything — subscriptions, groups, read/starred state, rules, preferences and cached articles — with a full JSON backup.')}
        </p>
        <div className="settings-data-actions">
          <button type="button" className="button button--ghost" onClick={onImport}>
            <Icon name="upload" size={15} />
            <span>{t('Import')}</span>
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={onExport}
            disabled={!hasFeeds}
          >
            <Icon name="download" size={15} />
            <span>{t('Export')}</span>
          </button>
          <button type="button" className="button button--ghost" onClick={onBackups}>
            <Icon name="refresh" size={15} />
            <span>{t('Backups')}</span>
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">{t('Local storage')}</h2>
        <p className="settings-note settings-note--tight">
          {t('{size} used · subscriptions, read state, rules and article cache stay on this device', { size: formatBytes(usage.used) })}
        </p>
        <div className="setting-row">
          <span className="setting-row__label">
            {t('Clear cached articles')}
            <small>
              {t('Removes downloaded content. Subscriptions, groups, rules and read state are kept.')}
            </small>
          </span>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void clearCache()}
            disabled={clearing}
          >
            {clearing ? t('Clearing…') : t('Clear cache')}
          </button>
        </div>
      </section>
    </>
  );
}
