import { useEffect, useState } from 'react';
import type { Density, FontSize, ReaderFont, ThemeMode } from '../types';
import { store } from '../store/store';
import { useStore } from '../hooks/useStore';
import { clearArticleCache, estimateUsage } from '../lib/storage';
import { formatBytes } from '../lib/format';
import { isDesktopApp } from '../lib/desktop';
import { setCloseToTray, setStartAtLogin } from '../lib/desktopSettings';
import { requestNotificationPermission } from '../lib/notifications';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { GroupsManager, SourcesManager } from './settings/CollectionManagers';
import { RulesPanel } from './settings/RulesPanel';

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

export function SettingsDialog({
  open,
  onClose,
  onImport,
  onExport,
  onBackups,
  hasFeeds,
  initialSection,
}: SettingsDialogProps) {
  const state = useStore();
  const desktop = isDesktopApp();
  const [usage] = useState(() => estimateUsage());
  const [clearing, setClearing] = useState(false);
  const [section, setSection] = useState<SettingsSection>('preferences');
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (open && initialSection) setSection(initialSection);
  }, [open, initialSection]);

  const clearCache = async () => {
    setClearing(true);
    await clearArticleCache();
    setClearing(false);
    store.notify('success', 'Article cache cleared');
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Settings"
      size="lg"
      className="settings-dialog"
    >
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`settings-nav__item ${section === entry.id ? 'is-active' : ''}`}
              aria-current={section === entry.id ? 'true' : undefined}
              onClick={() => setSection(entry.id)}
            >
              <Icon name={entry.icon} size={16} />
              <span>{entry.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-panel">
          {section === 'preferences' && (
            <>
              <section className="settings-section">
                <h2 className="settings-section__title">Appearance</h2>
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
                <Segmented<ReaderFont>
                  label="Reading font"
                  value={state.prefs.readerFont}
                  options={[
                    { value: 'sans', label: 'Sans' },
                    { value: 'serif', label: 'Serif' },
                    { value: 'mono', label: 'Mono' },
                  ]}
                  onChange={(readerFont) => store.setPreferences({ readerFont })}
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

              <section className="settings-section">
                <h2 className="settings-section__title">Reading</h2>
                <Toggle
                  label="Play media inline"
                  hint="YouTube, Vimeo, Spotify, SoundCloud, Deezer and Apple Podcasts play inside the reader. When off, they open in a new tab instead."
                  checked={state.prefs.embedMedia}
                  onChange={(embedMedia) => store.setPreferences({ embedMedia })}
                />
              </section>

              <section className="settings-section">
                <h2 className="settings-section__title">Desktop integration</h2>
                {desktop ? (
                  <>
                    <Toggle
                      label="Close to tray"
                      hint="Closing the window keeps the reader running in the tray. Use Quit in the tray menu to exit."
                      checked={state.prefs.closeToTray}
                      onChange={(closeToTray) => {
                        store.setPreferences({ closeToTray });
                        void setCloseToTray(closeToTray);
                      }}
                    />
                    <Toggle
                      label="Notify about new articles"
                      hint="Native notification when new items arrive while the window is in the background. Use a source's context menu to mute it."
                      checked={state.prefs.notifyNewArticles}
                      onChange={(enabled) => {
                        if (!enabled) {
                          store.setPreferences({ notifyNewArticles: false });
                          return;
                        }
                        void requestNotificationPermission().then((granted) => {
                          if (granted) store.setPreferences({ notifyNewArticles: true });
                          else store.notify('error', 'Notifications are blocked by the system.');
                        });
                      }}
                    />
                    <Toggle
                      label="Start at login"
                      hint="Launch the reader when you sign in. You can still quit it from the tray."
                      checked={state.prefs.startAtLogin}
                      onChange={(enabled) => {
                        void setStartAtLogin(enabled).then((ok) => {
                          if (!ok) {
                            store.notify('error', 'Could not change the login setting.');
                            return;
                          }
                          store.setPreferences({ startAtLogin: enabled });
                        });
                      }}
                    />
                  </>
                ) : (
                  <p className="settings-note">
                    Tray, notifications and start-at-login options are available in the desktop
                    app. The web/PWA build stays local and works offline once installed.
                  </p>
                )}
              </section>
            </>
          )}

          {section === 'groups' && (
            <section className="settings-section">
              <h2 className="settings-section__title">Groups</h2>
              <p className="settings-note settings-note--tight">
                Select groups to merge them into another group or delete them together. Merging
                keeps every source and only replaces the group label.
              </p>
              <GroupsManager idPrefix="settings" />
            </section>
          )}

          {section === 'sources' && (
            <section className="settings-section">
              <h2 className="settings-section__title">Sources</h2>
              <p className="settings-note settings-note--tight">
                Select sources to move them into a group or delete them in bulk. Deleting a source
                also removes its cached articles, read state and stars.
              </p>
              <SourcesManager idPrefix="settings" />
            </section>
          )}

          {section === 'rules' && <RulesPanel />}

          {section === 'services' && (
            <>
              <section className="settings-section">
                <h2 className="settings-section__title">YouTube Data API</h2>
                <p className="settings-note settings-note--tight">
                  Optional. Lets a channel/playlist feed pull up to 50 recent videos through the
                  official API instead of the ~15 YouTube&apos;s own public RSS feed caps at — from a
                  Google Cloud project with the YouTube Data API v3 enabled. Stored on this device
                  only and never included in backups.
                </p>
                <div className="setting-key-row">
                  <input
                    className="input"
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="Paste your API key"
                    autoComplete="off"
                    spellCheck={false}
                    value={state.prefs.youtubeApiKey}
                    onChange={(event) =>
                      store.setPreferences({ youtubeApiKey: event.target.value.trim() })
                    }
                  />
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setShowApiKey((value) => !value)}
                    aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                    title={showApiKey ? 'Hide API key' : 'Show API key'}
                  >
                    <Icon name={showApiKey ? 'eyeOff' : 'eye'} size={16} />
                  </button>
                </div>
              </section>

              <section className="settings-section">
                <h2 className="settings-section__title">Subscriptions & data</h2>
                <p className="settings-note settings-note--tight">
                  Import or export OPML, or move everything — subscriptions, groups, read/starred
                  state, rules, preferences and cached articles — with a full JSON backup.
                </p>
                <div className="settings-data-actions">
                  <button type="button" className="button button--ghost" onClick={onImport}>
                    <Icon name="upload" size={15} />
                    <span>Import</span>
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={onExport}
                    disabled={!hasFeeds}
                  >
                    <Icon name="download" size={15} />
                    <span>Export</span>
                  </button>
                  <button type="button" className="button button--ghost" onClick={onBackups}>
                    <Icon name="refresh" size={15} />
                    <span>Backups</span>
                  </button>
                </div>
                <div className="setting-row">
                  <span className="setting-row__label">
                    Local storage
                    <small>
                      {formatBytes(usage.used)} used · subscriptions, read state, rules and article
                      cache stay on this device
                    </small>
                  </span>
                </div>
                <div className="setting-row">
                  <span className="setting-row__label">
                    Clear cached articles
                    <small>
                      Removes downloaded content. Subscriptions, groups, rules and read state are
                      kept.
                    </small>
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

              <section className="settings-section">
                <h2 className="settings-section__title">Feed fetching</h2>
                <p className="settings-note settings-note--tight">
                  {desktop
                    ? 'The desktop app fetches feeds natively with ETag/Last-Modified validators and retry backoff.'
                    : 'The installed web/PWA build uses the local feed proxy at /proxy. Feed fetching needs that local server; reading cached articles works offline.'}
                </p>
              </section>
            </>
          )}

          {section === 'about' && (
            <>
              <section className="settings-section about">
                <div className="about__brand">
                  <span className="about__logo" aria-hidden="true">
                    <Icon name="rss" size={26} />
                  </span>
                  <div>
                    <h2 className="about__name">RSS Reader</h2>
                    <p className="about__version">Version {__APP_VERSION__}</p>
                  </div>
                </div>
                <p className="settings-note settings-note--tight">
                  A local-first RSS/Atom reader. Subscriptions, read/starred state, rules,
                  preferences and cached articles stay on this device — there is no account,
                  server or telemetry.
                </p>
                <p className="settings-note settings-note--tight">
                  Desktop builds use Tauri and the system WebView; the PWA build is installable
                  from the browser. Both share the same interface and JSON backup format.
                </p>
                <div className="settings-data-actions">
                  <a
                    className="button button--ghost"
                    href="https://github.com/MediaHub-Org/rss-reader"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Icon name="external" size={15} />
                    <span>Project on GitHub</span>
                  </a>
                </div>
              </section>

              <section className="settings-section">
                <h2 className="settings-section__title">Keyboard shortcuts</h2>
                <dl className="about-shortcuts">
                  <div>
                    <dt>
                      <kbd>j</kbd> / <kbd>k</kbd> <span>or</span> <kbd>↓</kbd> / <kbd>↑</kbd>
                    </dt>
                    <dd>Move through articles</dd>
                  </div>
                  <div>
                    <dt>
                      <kbd>←</kbd> / <kbd>→</kbd>
                    </dt>
                    <dd>Previous / next article</dd>
                  </div>
                  <div>
                    <dt>
                      <kbd>Enter</kbd> / <kbd>o</kbd>
                    </dt>
                    <dd>Open the selected article</dd>
                  </div>
                  <div>
                    <dt>
                      <kbd>m</kbd>
                    </dt>
                    <dd>Toggle read / unread</dd>
                  </div>
                  <div>
                    <dt>
                      <kbd>r</kbd>
                    </dt>
                    <dd>Refresh all sources</dd>
                  </div>
                  <div>
                    <dt>
                      <kbd>/</kbd>
                    </dt>
                    <dd>Focus search</dd>
                  </div>
                  <div>
                    <dt>
                      <kbd>a</kbd>
                    </dt>
                    <dd>Add source</dd>
                  </div>
                  <div>
                    <dt>
                      <kbd>Esc</kbd>
                    </dt>
                    <dd>Close article, drawer or dialog</dd>
                  </div>
                </dl>
              </section>

              <section className="settings-section">
                <h2 className="settings-section__title">Data</h2>
                <p className="settings-note settings-note--tight">
                  {formatBytes(usage.used)} stored locally in this app&apos;s profile. Clearing the
                  article cache from Services keeps subscriptions and reading state intact.
                </p>
              </section>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
