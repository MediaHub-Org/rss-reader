import { formatBytes } from '../../lib/format';
import { store } from '../../store/store';
import { useStore } from '../../hooks/useStore';
import { copyText } from '../../lib/clipboard';
import { isDesktopApp, isTauriApp } from '../../lib/desktop';
import { t } from '../../lib/i18n';
import { Icon } from '../Icon';

export function AboutPanel({ usage }: { usage: { used: number } }) {
  const state = useStore();
  const platform = isDesktopApp() ? 'desktop' : isTauriApp() ? 'mobile' : 'web';

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
