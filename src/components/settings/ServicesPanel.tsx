import { useState } from 'react';
import { store } from '../../store/store';
import { useStore } from '../../hooks/useStore';
import { isDesktopApp } from '../../lib/desktop';
import { Icon } from '../Icon';
import { t } from '../../lib/i18n';

export function ServicesPanel() {
  const state = useStore();
  const desktop = isDesktopApp();
  const [showApiKey, setShowApiKey] = useState(false);

  return (
    <>
      <section className="settings-section">
        <h2 className="settings-section__title">{t('Local only (no sync)')}</h2>
        <p className="settings-note settings-note--tight">
          {t('This reader has no account, no sync service and no server. Subscriptions, read/starred state and cached articles stay on this device. Use OPML or a full backup to move them.')}
        </p>
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
