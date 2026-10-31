import type { Density, FontSize, LanguagePreference, ReaderFont, RefreshInterval, ThemeMode } from '../../types';
import { store } from '../../store/store';
import { useStore } from '../../hooks/useStore';
import { isDesktopApp } from '../../lib/desktop';
import { setCloseToTray, setStartAtLogin } from '../../lib/desktopSettings';
import { requestNotificationPermission } from '../../lib/notifications';
import { Segmented, Toggle } from './Controls';
import { t } from '../../lib/i18n';

export function PreferencesPanel() {
  const state = useStore();
  const desktop = isDesktopApp();

  return (
    <>
      <section className="settings-section">
        <h2 className="settings-section__title">{t('Appearance')}</h2>
        <Segmented<LanguagePreference>
          label={t('Language')}
          value={state.prefs.language}
          options={[
            { value: 'system', label: t('System') },
            { value: 'en', label: 'English' },
            { value: 'es', label: 'Español' },
          ]}
          onChange={(language) => store.setPreferences({ language })}
        />
        <Segmented<RefreshInterval>
          label={t('Refresh feeds')}
          value={state.prefs.refreshInterval}
          options={[
            { value: 'manual', label: t('Manual') },
            { value: '15', label: '15 min' },
            { value: '30', label: '30 min' },
            { value: '60', label: t('1 hour') },
            { value: '180', label: t('3 hours') },
          ]}
          onChange={(refreshInterval) => store.setPreferences({ refreshInterval })}
        />
        <Segmented<ThemeMode>
          label={t('Theme')}
          value={state.prefs.theme}
          options={[
            { value: 'light', label: t('Light') },
            { value: 'dark', label: t('Dark') },
            { value: 'system', label: t('System') },
          ]}
          onChange={(theme) => store.setPreferences({ theme })}
        />
        <Segmented<Density>
          label={t('List density')}
          value={state.prefs.density}
          options={[
            { value: 'comfortable', label: t('Comfortable') },
            { value: 'compact', label: t('Compact') },
          ]}
          onChange={(density) => store.setPreferences({ density })}
        />
        <Segmented<ReaderFont>
          label={t('Reading font')}
          value={state.prefs.readerFont}
          options={[
            { value: 'sans', label: t('Sans') },
            { value: 'serif', label: t('Serif') },
            { value: 'mono', label: t('Mono') },
          ]}
          onChange={(readerFont) => store.setPreferences({ readerFont })}
        />
        <Segmented<FontSize>
          label={t('Reader font size')}
          value={state.prefs.fontSize}
          options={[
            { value: 'small', label: t('Small') },
            { value: 'medium', label: t('Medium') },
            { value: 'large', label: t('Large') },
          ]}
          onChange={(fontSize) => store.setPreferences({ fontSize })}
        />
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">{t('Reading')}</h2>
        <Toggle
          label={t('Play media inline')}
          hint={t("YouTube, Vimeo, Spotify, SoundCloud, Deezer and Apple Podcasts play inside the reader. When off, they open in a new tab instead.")}
          checked={state.prefs.embedMedia}
          onChange={(embedMedia) => store.setPreferences({ embedMedia })}
        />
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">{t('Desktop integration')}</h2>
        {desktop ? (
          <>
            <Toggle
              label={t('Close to tray')}
              hint={t("Closing the window keeps the reader running in the tray. Use Quit in the tray menu to exit.")}
              checked={state.prefs.closeToTray}
              onChange={(closeToTray) => {
                store.setPreferences({ closeToTray });
                void setCloseToTray(closeToTray);
              }}
            />
            <Toggle
              label={t('Notify about new articles')}
              hint={t("Native notification when new items arrive while the window is in the background. Use a source's context menu to mute it.")}
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
              label={t('Start at login')}
              hint={t("Launch the reader when you sign in. You can still quit it from the tray.")}
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
            {t('Tray, notifications and start-at-login options are available in the desktop app. The web/PWA build stays local and works offline once installed.')}
          </p>
        )}
      </section>
    </>
  );
}
