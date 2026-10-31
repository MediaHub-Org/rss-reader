import { useState } from 'react';
import type { SyncService } from '../../types';
import { store } from '../../store/store';
import { useStore } from '../../hooks/useStore';
import { isDesktopApp } from '../../lib/desktop';
import { Dropdown, type DropdownOption } from '../Dropdown';
import { Icon } from '../Icon';
import { t } from '../../lib/i18n';

const SYNC_SERVICES: Array<{
  value: SyncService;
  label: string;
  hint: string;
  endpoint: string;
}> = [
  {
    value: 'local',
    label: 'Local only (no sync)',
    hint: 'Everything stays on this device.',
    endpoint: '',
  },
  {
    value: 'fever',
    label: 'Fever API',
    hint: 'FreshRSS, Tiny Tiny RSS (Fever plugin) and compatible servers.',
    endpoint: 'https://reader.example.com/fever/',
  },
  {
    value: 'feedbin',
    label: 'Feedbin',
    hint: 'Feedbin’s REST API.',
    endpoint: 'https://api.feedbin.com/v2/',
  },
  {
    value: 'inoreader',
    label: 'Inoreader',
    hint: 'Inoreader’s Reader API.',
    endpoint: 'https://www.inoreader.com/reader/api/0/',
  },
  {
    value: 'miniflux',
    label: 'Miniflux',
    hint: 'A self-hosted Miniflux instance.',
    endpoint: 'https://miniflux.example.com/v1/',
  },
  {
    value: 'nextcloud',
    label: 'Nextcloud News API',
    hint: 'The News app on your Nextcloud server.',
    endpoint: 'https://cloud.example.com/index.php/apps/news/api/v1-2/',
  },
  {
    value: 'newsblur',
    label: 'NewsBlur',
    hint: 'NewsBlur’s API.',
    endpoint: 'https://www.newsblur.com/',
  },
];

const syncOptions = (): Array<DropdownOption<SyncService>> =>
  SYNC_SERVICES.map((entry) => ({
    value: entry.value,
    label: t(entry.label),
    hint: t(entry.hint),
  }));

export function ServicesPanel() {
  const state = useStore();
  const desktop = isDesktopApp();
  const [showApiKey, setShowApiKey] = useState(false);
  /** Session-only until a real sync engine exists; never written to storage. */
  const [syncPassword, setSyncPassword] = useState('');
  const service = SYNC_SERVICES.find((entry) => entry.value === state.prefs.syncService);

  return (
    <>
      <section className="settings-section">
        <h2 className="settings-section__title">{t('Sync service')}</h2>
        <p className="settings-note settings-note--tight">
          {t('Choose an external reader service or stay local. Connection details are stored on this device only and are never included in backups.')}
        </p>
        <div className="setting-row">
          <span className="setting-row__label">
            {t('Service')}
            <small>{service ? t(service.hint) : ''}</small>
          </span>
          <Dropdown<SyncService>
            value={state.prefs.syncService}
            options={syncOptions()}
            onChange={(syncService) => store.setPreferences({ syncService })}
            label="Sync service"
            className="settings-sync-select"
          />
        </div>

        {state.prefs.syncService !== 'local' && (
          <>
            <div className="settings-sync-fields">
              <label className="field">
                <span className="field__label">{t('Server URL')}</span>
                <input
                  className="input"
                  type="url"
                  placeholder={service?.endpoint}
                  value={state.prefs.syncServer}
                  onChange={(event) =>
                    store.setPreferences({ syncServer: event.target.value.trim() })
                  }
                  spellCheck={false}
                />
              </label>
              <label className="field">
                <span className="field__label">{t('Username')}</span>
                <input
                  className="input"
                  autoComplete="username"
                  value={state.prefs.syncUsername}
                  onChange={(event) => store.setPreferences({ syncUsername: event.target.value })}
                />
              </label>
              <label className="field">
                <span className="field__label">{t('Password / API token')}</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={syncPassword}
                  onChange={(event) => setSyncPassword(event.target.value)}
                />
              </label>
            </div>
            <p className="settings-note settings-note--tight">
              {t('Server and username are saved locally; the password/token is kept only for this session. Two-way sync is not enabled in this build yet; use OPML or a full backup to move subscriptions today.')}
            </p>
          </>
        )}
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">{t('YouTube Data API')}</h2>
        <p className="settings-note settings-note--tight">
          {t('Optional. Lets a channel/playlist feed pull up to 50 recent videos through the official API instead of the ~15 YouTube’s own public RSS feed caps at — from a Google Cloud project with the YouTube Data API v3 enabled. Stored on this device only and never included in backups.')}
        </p>
        <div className="setting-key-row">
          <input
            className="input"
            type={showApiKey ? 'text' : 'password'}
            placeholder={t('Paste your API key')}
            autoComplete="off"
            spellCheck={false}
            value={state.prefs.youtubeApiKey}
            onChange={(event) => store.setPreferences({ youtubeApiKey: event.target.value.trim() })}
          />
          <button
            type="button"
            className="icon-button"
            onClick={() => setShowApiKey((value) => !value)}
            aria-label={t(showApiKey ? 'Hide API key' : 'Show API key')}
            title={t(showApiKey ? 'Hide API key' : 'Show API key')}
          >
            <Icon name={showApiKey ? 'eyeOff' : 'eye'} size={16} />
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">{t('Feed fetching')}</h2>
        <p className="settings-note settings-note--tight">
          {desktop
            ? 'The desktop app fetches feeds natively with ETag/Last-Modified validators and retry backoff.'
            : 'The installed web/PWA build uses the local feed proxy at /proxy. Feed fetching needs that local server; reading cached articles works offline.'}
        </p>
      </section>
    </>
  );
}
