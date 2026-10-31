import { useEffect, useState } from 'react';
import { SourcesManager, GroupsManager } from './CollectionManagers';
import { t } from '../../lib/i18n';

export type ManageTab = 'sources' | 'groups';

interface ManagePanelProps {
  initialTab?: ManageTab;
  onImport: () => void;
}

/** Sources and groups share one section with two tabs. */
export function ManagePanel({ initialTab = 'sources', onImport }: ManagePanelProps) {
  const [tab, setTab] = useState<ManageTab>(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">{t('Manage')}</h2>
      <p className="settings-note settings-note--tight">
        {t('Edit or remove sources, organize them into groups, and select several at once for bulk actions.')}
      </p>

      <div className="manage-subtabs" role="tablist" aria-label={t('Manage sources and groups')}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'sources'}
          className={`manage-subtab ${tab === 'sources' ? 'is-active' : ''}`}
          onClick={() => setTab('sources')}
        >
          {t('Sources')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'groups'}
          className={`manage-subtab ${tab === 'groups' ? 'is-active' : ''}`}
          onClick={() => setTab('groups')}
        >
          {t('Groups')}
        </button>
      </div>

      {tab === 'sources' ? (
        <SourcesManager idPrefix="settings" onImport={onImport} />
      ) : (
        <GroupsManager idPrefix="settings" />
      )}
    </section>
  );
}
