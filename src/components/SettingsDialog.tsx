import { useState } from 'react';
import type { Density, FontSize, ThemeMode } from '../types';
import { store } from '../store/store';
import { useStore } from '../hooks/useStore';
import { clearArticleCache, estimateUsage } from '../lib/storage';
import { formatBytes } from '../lib/format';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: () => void;
  onExport: () => void;
  onManage: () => void;
  hasFeeds: boolean;
}

type Section = 'general' | 'data' | 'appearance';

const SECTIONS: Array<{ id: Section; label: string; icon: 'settings' | 'download' | 'sun' }> = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'data', label: 'Data', icon: 'download' },
  { id: 'appearance', label: 'Appearance', icon: 'sun' },
];

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="setting-row">
      <span className="setting-row__label" id={`label-${label}`}>
        {label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={`label-${label}`}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={`segmented__option ${value === option.value ? 'is-active' : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <span className="setting-row__label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`switch ${checked ? 'is-on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch__thumb" />
      </button>
    </div>
  );
}

export function SettingsDialog({ open, onClose, onImport, onExport, onManage, hasFeeds }: SettingsDialogProps) {
  const state = useStore();
  const [usage] = useState(() => estimateUsage());
  const [clearing, setClearing] = useState(false);
  const [section, setSection] = useState<Section>('general');
  const [showApiKey, setShowApiKey] = useState(false);

  const clearCache = async () => {
    setClearing(true);
    await clearArticleCache();
    setClearing(false);
    store.notify('success', 'Article cache cleared');
  };

  return (
    <Dialog open={open} onClose={onClose} title="Settings" size="lg">
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`settings-nav__item ${section === s.id ? 'is-active' : ''}`}
              aria-current={section === s.id ? 'true' : undefined}
              onClick={() => setSection(s.id)}
            >
              <Icon name={s.icon} size={16} />
              <span>{s.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-panel">
          {section === 'general' && (
            <section className="settings-section">
              <Toggle
                label="Play media inline"
                hint="YouTube, Vimeo, Spotify, SoundCloud, Deezer and Apple Podcasts play inside the reader. When off, they open in a new tab instead."
                checked={state.prefs.embedMedia}
                onChange={(embedMedia) => store.setPreferences({ embedMedia })}
              />

              <Toggle
                label="Hide read articles"
                checked={state.prefs.hideRead}
                onChange={(hideRead) => store.setPreferences({ hideRead })}
              />

              <div className="setting-row">
                <span className="setting-row__label">
                  YouTube Data API key
                  <small>
                    Optional. Lets a channel/playlist feed pull up to 50 recent videos through the
                    official API instead of the ~15 YouTube's own public RSS feed caps at — from a
                    Google Cloud project with the YouTube Data API v3 enabled. Stored on this device
                    only.
                  </small>
                </span>
              </div>
              <div className="setting-key-row">
                <input
                  className="input"
                  type={showApiKey ? 'text' : 'password'}
                  placeholder="Paste your API key"
                  autoComplete="off"
                  spellCheck={false}
                  value={state.prefs.youtubeApiKey}
                  onChange={(event) => store.setPreferences({ youtubeApiKey: event.target.value.trim() })}
                />
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setShowApiKey((v) => !v)}
                  aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                  title={showApiKey ? 'Hide API key' : 'Show API key'}
                >
                  <Icon name={showApiKey ? 'eyeOff' : 'eye'} size={16} />
                </button>
              </div>

              <p className="settings-note">
                Keyboard: <kbd>j</kbd>/<kbd>k</kbd> navigate · <kbd>o</kbd> open · <kbd>m</kbd> toggle read ·{' '}
                <kbd>r</kbd> refresh · <kbd>/</kbd> search · <kbd>Esc</kbd> back
              </p>
            </section>
          )}

          {section === 'data' && (
            <section className="settings-section">
              <div className="setting-row">
                <span className="setting-row__label">
                  Subscriptions
                  <small>Import an OPML/JSON file, export your current feeds, or manage what you're subscribed to.</small>
                </span>
              </div>
              <div className="settings-data-actions">
                <button type="button" className="button button--ghost" onClick={onImport}>
                  <Icon name="upload" size={15} />
                  <span>Import</span>
                </button>
                <button type="button" className="button button--ghost" onClick={onExport} disabled={!hasFeeds}>
                  <Icon name="download" size={15} />
                  <span>Export</span>
                </button>
                <button type="button" className="button button--ghost" onClick={onManage} disabled={!hasFeeds}>
                  <Icon name="trash" size={15} />
                  <span>Manage</span>
                </button>
              </div>

              <div className="setting-row">
                <span className="setting-row__label">
                  Local storage
                  <small>
                    {formatBytes(usage.used)} used · subscriptions, read status and article cache stay on this
                    device
                  </small>
                </span>
              </div>
              <div className="setting-row">
                <span className="setting-row__label">
                  Clear cached articles
                  <small>Removes downloaded content. Subscriptions and read state are kept.</small>
                </span>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => void clearCache()}
                  disabled={clearing}
                >
                  {clearing ? 'Clearing…' : 'Clear cache'}
                </button>
              </div>
            </section>
          )}

          {section === 'appearance' && (
            <section className="settings-section">
              <Segmented<ThemeMode>
                label="Theme"
                value={state.prefs.theme}
                options={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'system', label: 'System' },
                ]}
                onChange={(theme) => store.setPreferences({ theme })}
              />

              <Segmented<Density>
                label="List density"
                value={state.prefs.density}
                options={[
                  { value: 'comfortable', label: 'Comfortable' },
                  { value: 'compact', label: 'Compact' },
                ]}
                onChange={(density) => store.setPreferences({ density })}
              />

              <Segmented<FontSize>
                label="Reader font size"
                value={state.prefs.fontSize}
                options={[
                  { value: 'small', label: 'Small' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'large', label: 'Large' },
                ]}
                onChange={(fontSize) => store.setPreferences({ fontSize })}
              />
            </section>
          )}
        </div>
      </div>
    </Dialog>
  );
}
