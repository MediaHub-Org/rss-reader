import { formatBytes } from '../../lib/format';
import { Icon } from '../Icon';

export function AboutPanel({ usage }: { usage: { used: number } }) {
  return (
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
          A local-first RSS/Atom reader. Subscriptions, read/starred state, rules, preferences and
          cached articles stay on this device — there is no account, server or telemetry.
        </p>
        <p className="settings-note settings-note--tight">
          Desktop builds use Tauri and the system WebView; the PWA build is installable from the
          browser. Both share the same interface and JSON backup format.
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
          {formatBytes(usage.used)} stored locally in this app&apos;s profile. Clearing the article
          cache from Services keeps subscriptions and reading state intact.
        </p>
      </section>
    </>
  );
}
