import type { Density, FontSize, ReaderFont, ThemeMode } from '../../types';
import { store } from '../../store/store';
import { useStore } from '../../hooks/useStore';
import { isDesktopApp } from '../../lib/desktop';
import { setCloseToTray, setStartAtLogin } from '../../lib/desktopSettings';
import { requestNotificationPermission } from '../../lib/notifications';
import { Segmented, Toggle } from './Controls';

export function PreferencesPanel() {
  const state = useStore();
  const desktop = isDesktopApp();

  return (
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
            Tray, notifications and start-at-login options are available in the desktop app. The
            web/PWA build stays local and works offline once installed.
          </p>
        )}
      </section>
    </>
  );
}
