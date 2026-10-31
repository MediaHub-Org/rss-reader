import { useEffect, useState } from 'react';
import { estimateUsage } from '../lib/storage';
import { useStore } from '../hooks/useStore';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { t } from '../lib/i18n';
import { AboutPanel } from './settings/AboutPanel';
import { GroupsManager, SourcesManager } from './settings/CollectionManagers';
import { PreferencesPanel } from './settings/PreferencesPanel';
import { RulesPanel } from './settings/RulesPanel';
import { ServicesPanel } from './settings/ServicesPanel';

export type SettingsSection =
  | 'preferences'
  | 'groups'
  | 'sources'
  | 'rules'
  | 'services'
  | 'about';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: () => void;
  onExport: () => void;
  onBackups: () => void;
  hasFeeds: boolean;
  initialSection?: SettingsSection;
}

const SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  icon: 'sliders' | 'folder' | 'rss' | 'filter' | 'link' | 'info';
}> = [
  { id: 'preferences', label: 'Preferences', icon: 'sliders' },
  { id: 'groups', label: 'Groups', icon: 'folder' },
  { id: 'sources', label: 'Sources', icon: 'rss' },
  { id: 'rules', label: 'Rules', icon: 'filter' },
  { id: 'services', label: 'Services & Integration', icon: 'link' },
  { id: 'about', label: 'About', icon: 'info' },
];

export function SettingsDialog({
  open,
  onClose,
  onImport,
  onExport,
  onBackups,
  hasFeeds,
  initialSection,
}: SettingsDialogProps) {
  useStore(); // language changes must re-render the nav labels
  const [usage] = useState(() => estimateUsage());
  const [section, setSection] = useState<SettingsSection>('preferences');

  useEffect(() => {
    if (open && initialSection) setSection(initialSection);
  }, [open, initialSection]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('Settings')}
      size="lg"
      className="settings-dialog"
    >
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('Settings sections')}>
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`settings-nav__item ${section === entry.id ? 'is-active' : ''}`}
              aria-current={section === entry.id ? 'true' : undefined}
              onClick={() => setSection(entry.id)}
            >
              <Icon name={entry.icon} size={16} />
              <span>{t(entry.label)}</span>
            </button>
          ))}
        </nav>

        <div className="settings-panel">
          {section === 'preferences' && <PreferencesPanel />}

          {section === 'groups' && (
            <section className="settings-section">
              <h2 className="settings-section__title">{t('Groups')}</h2>
              <p className="settings-note settings-note--tight">
                {t('Select groups to merge them into another group or delete them together. Merging keeps every source and only replaces the group label.')}
              </p>
              <GroupsManager idPrefix="settings" />
            </section>
          )}

          {section === 'sources' && (
            <section className="settings-section">
              <h2 className="settings-section__title">{t('Sources')}</h2>
              <p className="settings-note settings-note--tight">
                {t('Select sources to move them into a group or delete them in bulk. Deleting a source also removes its cached articles, read state and stars.')}
              </p>
              <SourcesManager idPrefix="settings" onImport={onImport} />
            </section>
          )}

          {section === 'rules' && <RulesPanel />}

          {section === 'services' && (
            <ServicesPanel
              onImport={onImport}
              onExport={onExport}
              onBackups={onBackups}
              hasFeeds={hasFeeds}
              usage={usage}
            />
          )}

          {section === 'about' && <AboutPanel usage={usage} />}
        </div>
      </div>
    </Dialog>
  );
}
