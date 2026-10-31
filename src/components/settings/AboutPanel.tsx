import { useEffect, useState } from 'react';
import { formatBytes } from '../../lib/format';
import { store } from '../../store/store';
import { useStore } from '../../hooks/useStore';
import { copyText } from '../../lib/clipboard';
import { isDesktopApp, isTauriApp } from '../../lib/desktop';
import { t } from '../../lib/i18n';
import { Icon } from '../Icon';
import { checkForUpdate, type UpdateInfo } from '../../lib/updates';

export function AboutPanel({ usage }: { usage: { used: number } }) {
  const state = useStore();
  const platform = isDesktopApp() ? 'desktop' : isTauriApp() ? 'mobile' : 'web';
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null | undefined>(undefined);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void checkForUpdate()
      .then((result) => {
        if (alive) setUpdate(result);
      })
      .catch(() => {
        // A failed background check stays silent; the button reports errors.
      });
    return () => {
      alive = false;
    };
  }, []);

  const checkUpdates = async () => {
    setChecking(true);
    setUpdateError(null);
    try {
      setUpdate(await checkForUpdate({ force: true }));
    } catch {
      setUpdateError(t('Could not check for updates.'));
    } finally {
      setChecking(false);
    }
  };

  const copyDiagnostics = async () => {
    const diagnostics = {
      version: __APP_VERSION__,
      platform,
      feeds: state.feeds.length,
      folders: state.folders.length,
      cachedArticles: Object.values(state.articles).flat().length,
      readEntries: Object.keys(state.readIds).length,
      starredArticles: Object.keys(state.starredIds).length,
      rules: state.rules.length,
      storageBytes: usage.used,
    };
    const ok = await copyText(JSON.stringify(diagnostics, null, 2));
    store.notify(ok ? 'success' : 'error', ok ? 'Diagnostics copied' : 'Could not copy diagnostics');
  };

  return (
    <>
      <section className="settings-section about">
        <div className="about__brand">
          <span className="about__logo" aria-hidden="true">
            <Icon name="rss" size={26} />
          </span>
          <div>
            <h2 className="about__name">RSS Reader</h2>
            <p className="about__version">{t('Version')} {__APP_VERSION__}</p>
          </div>
        </div>
        <p className="settings-note settings-note--tight">
          {t('A local-first RSS/Atom reader. Subscriptions, read/starred state, rules, preferences and cached articles stay on this device — there is no account, server or telemetry.')}
        </p>
        <p className="settings-note settings-note--tight">
          {t('Desktop builds use Tauri and the system WebView; the PWA build is installable from the browser. Both share the same interface and JSON backup format.')}
        </p>
        <div className="settings-data-actions">
          <a
            className="button button--ghost"
            href="https://github.com/MediaHub-Org/rss-reader"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="external" size={15} />
            <span>{t('Project on GitHub')}</span>
          </a>
          <button type="button" className="button button--ghost" onClick={() => void copyDiagnostics()}>
            <Icon name="copy" size={15} />
            <span>{t('Copy diagnostics')}</span>
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">{t('Updates')}</h2>
        <p className="settings-note settings-note--tight">
          {t('Updates are published on GitHub. The installer replaces the current version, so no uninstall is needed.')}
        </p>
        <div className="settings-data-actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void checkUpdates()}
            disabled={checking}
          >
            <Icon name="refresh" size={15} />
            <span>{checking ? t('Checking…') : t('Check for updates')}</span>
          </button>
          {update && (
            <a
              className="button button--primary"
              href={update.downloadUrl ?? update.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="download" size={15} />
              <span>{t('Download update')}</span>
            </a>
          )}
        </div>
        {updateError && (
          <p className="field__error" role="alert">
            {updateError}
          </p>
        )}
        {update === null && (
          <p className="settings-note settings-note--tight">
            {t('You are up to date on {version}.', { version: __APP_VERSION__ })}
          </p>
        )}
        {update && (
          <p className="settings-note settings-note--tight">
            {t('Version {version} is available.', { version: update.version })}{' '}
            <a href={update.releaseUrl} target="_blank" rel="noopener noreferrer">
              {t('Release notes')}
            </a>
          </p>
        )}
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">{t('Keyboard shortcuts')}</h2>
        <dl className="about-shortcuts">
          <div>
            <dt>
              <kbd>j</kbd> / <kbd>k</kbd> <span>or</span> <kbd>↓</kbd> / <kbd>↑</kbd>
            </dt>
            <dd>{t('Move through articles')}</dd>
          </div>
          <div>
            <dt>
              <kbd>←</kbd> / <kbd>→</kbd>
            </dt>
            <dd>{t('Previous / next article')}</dd>
          </div>
          <div>
            <dt>
              <kbd>Enter</kbd> / <kbd>o</kbd>
            </dt>
            <dd>{t('Open the selected article')}</dd>
          </div>
          <div>
            <dt>
              <kbd>m</kbd>
            </dt>
            <dd>{t('Toggle read / unread')}</dd>
          </div>
          <div>
            <dt>
              <kbd>r</kbd>
            </dt>
            <dd>{t('Refresh all sources')}</dd>
          </div>
          <div>
            <dt>
              <kbd>/</kbd>
            </dt>
            <dd>{t('Focus search')}</dd>
          </div>
          <div>
            <dt>
              <kbd>a</kbd>
            </dt>
            <dd>{t('Add source')}</dd>
          </div>
          <div>
            <dt>
              <kbd>Esc</kbd>
            </dt>
            <dd>{t('Close article, drawer or dialog')}</dd>
          </div>
        </dl>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">{t('Data')}</h2>
        <p className="settings-note settings-note--tight">
          {t('{size} stored locally in this app’s profile. Clearing the article cache from Services keeps subscriptions and reading state intact.', { size: formatBytes(usage.used) })}
        </p>
      </section>
    </>
  );
}
