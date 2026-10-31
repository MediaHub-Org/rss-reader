import { useEffect, useRef, useState } from 'react';
import { estimateUsage } from '../lib/storage';
import { useStore } from '../hooks/useStore';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { t } from '../lib/i18n';
import { AboutPanel } from './settings/AboutPanel';
import { ManagePanel, type ManageTab } from './settings/ManagePanel';
import { DataPanel } from './settings/DataPanel';
import { PreferencesPanel } from './settings/PreferencesPanel';
import { RulesPanel } from './settings/RulesPanel';
import { ServicesPanel } from './settings/ServicesPanel';

export type SettingsSection =
  | 'preferences'
  | 'manage'
  | 'rules'
  | 'services'
  | 'data'
  | 'about';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: () => void;
  onExport: () => void;
  onBackups: () => void;
  hasFeeds: boolean;
  initialSection?: SettingsSection;
  initialManageTab?: ManageTab;
}

const SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  icon: 'sliders' | 'folder' | 'filter' | 'link' | 'download' | 'info';
}> = [
  { id: 'preferences', label: 'Preferences', icon: 'sliders' },
  { id: 'manage', label: 'Manage', icon: 'folder' },
  { id: 'rules', label: 'Rules', icon: 'filter' },
  { id: 'services', label: 'Services', icon: 'link' },
  { id: 'data', label: 'Data', icon: 'download' },
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
  initialManageTab,
}: SettingsDialogProps) {
  useStore(); // language changes must re-render the nav labels
  const [usage] = useState(() => estimateUsage());
  const [section, setSection] = useState<SettingsSection>('preferences');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && initialSection) setSection(initialSection);
  }, [open, initialSection]);

  // The dialog body is the scroll container. Without resetting it, switching
  // from a long section (e.g. Preferences) to Sources leaves the new section
  // scrolled past its heading and list, which looks like an empty page.
  useEffect(() => {
    panelRef.current?.closest('.dialog__body')?.scrollTo({ top: 0 });
  }, [section, open]);

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

        <div className="settings-panel" ref={panelRef}>
          {section === 'preferences' && <PreferencesPanel />}

          {section === 'manage' && (
            <ManagePanel initialTab={initialManageTab} onImport={onImport} />
          )}

          {section === 'rules' && <RulesPanel />}

          {section === 'services' && <ServicesPanel />}

          {section === 'data' && (
            <DataPanel
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
