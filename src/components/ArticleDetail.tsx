import { useMemo, useState } from 'react';
import type { Feed } from '../types';
import { store } from '../store/store';
import { useStore } from '../hooks/useStore';
import { sanitizeHtml } from '../lib/sanitize';
import { formatDate } from '../lib/format';
import { copyText } from '../lib/clipboard';
import { embedUrl, thumbnailUrl, watchUrl } from '../lib/youtube';
import { Icon } from './Icon';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

type DetailMenu =
  | { kind: 'article'; x: number; y: number }
  | { kind: 'link'; x: number; y: number; href: string; text: string };

export function ArticleDetail() {
  const state = useStore();
  const [menu, setMenu] = useState<DetailMenu | null>(null);

  const article = useMemo(
    () => Object.values(state.articles).flat().find((a) => a.id === state.ui.activeArticleId),
    [state.articles, state.ui.activeArticleId]
  );
  const feed: Feed | undefined = article
    ? state.feeds.find((f) => f.id === article.feedId)
    : undefined;

  const html = useMemo(() => {
    if (!article) return '';
    const base = article.link || feed?.siteUrl || feed?.url;
    return sanitizeHtml(article.contentHtml, base);
  }, [article, feed]);

  if (!article) {
    return (
      <div className="detail detail--empty">
        <div className="empty-state">
          <Icon name="book" size={38} />
          <h2>No article selected</h2>
          <p>Choose an article from the list to read it here.</p>
        </div>
      </div>
    );
  }

  const read = Boolean(state.readIds[article.id]);
  const showEmbed = state.prefs.embedYouTube && article.youtubeId;

  /**
   * Links inside feed HTML get app actions (open/copy); plain article text
   * keeps the browser's native menu so selecting and copying prose still
   * works. The global handler in main.tsx skips `.content` for the same
   * reason.
   */
  const handleContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    const element = event.target as HTMLElement;
    const anchor = element.closest('a[href]') as HTMLAnchorElement | null;
    if (anchor) {
      if (!/^https?:/i.test(anchor.href)) return;
      event.preventDefault();
      setMenu({
        kind: 'link',
        href: anchor.href,
        text: anchor.textContent?.trim() || anchor.href,
        x: event.clientX,
        y: event.clientY,
      });
      return;
    }
    if (element.closest('.content')) return;
    event.preventDefault();
    setMenu({ kind: 'article', x: event.clientX, y: event.clientY });
  };

  const copyValue = async (value: string, label: string) => {
    const ok = await copyText(value);
    store.notify(
      ok ? 'success' : 'error',
      ok ? `${label} copied to the clipboard` : `Could not copy ${label.toLowerCase()}`
    );
  };

  const menuItems = (): ContextMenuItem[] => {
    if (!menu) return [];
    if (menu.kind === 'link') {
      return [
        {
          icon: 'external',
          label: 'Open link in new tab',
          onSelect: () => window.open(menu.href, '_blank', 'noopener,noreferrer'),
        },
        {
          icon: 'copy',
          label: 'Copy link address',
          onSelect: () => void copyValue(menu.href, 'Link'),
        },
        {
          icon: 'copy',
          label: 'Copy link text',
          onSelect: () => void copyValue(menu.text, 'Link text'),
        },
      ];
    }

    const items: ContextMenuItem[] = [];
    if (article.link) {
      items.push({
        icon: 'external',
        label: 'Open original in new tab',
        onSelect: () => window.open(article.link as string, '_blank', 'noopener,noreferrer'),
      });
      items.push({
        icon: 'copy',
        label: 'Copy article link',
        onSelect: () => void copyValue(article.link as string, 'Article link'),
      });
    }
    items.push({
      icon: 'copy',
      label: 'Copy title',
      onSelect: () => void copyValue(article.title, 'Title'),
    });
    items.push({
      icon: read ? 'eyeOff' : 'eye',
      label: read ? 'Mark as unread' : 'Mark as read',
      onSelect: () => store.toggleRead(article.id),
    });
    if (feed) {
      items.push({ type: 'divider' });
      items.push({
        icon: 'rss',
        label: `Show only ${feed.title}`,
        onSelect: () => store.setActiveFeed(feed.id),
      });
    }
    return items;
  };

  return (
    <article className="detail" onContextMenu={handleContextMenu}>
      <div className="detail__bar">
        <button
          type="button"
          className="ghost-button"
          onClick={() => store.setActiveArticle(null)}
          aria-label="Back to article list"
        >
          <Icon name="back" size={16} />
          <span>Back</span>
        </button>

        <div className="detail__actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => store.toggleRead(article.id)}
            aria-label={read ? 'Mark as unread' : 'Mark as read'}
          >
            <Icon name={read ? 'eyeOff' : 'eye'} size={16} />
            <span>{read ? 'Unread' : 'Read'}</span>
          </button>

          {article.link && (
            <a
              className="ghost-button"
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open original article in a new tab"
            >
              <Icon name="external" size={16} />
              <span>Original</span>
            </a>
          )}
        </div>
      </div>

      <div className="detail__scroll">
        <header className="detail__header">
          {feed && <p className="detail__feed">{feed.title}</p>}
          <h2 className="detail__title">{article.title}</h2>
          <p className="detail__meta">
            {article.author && <span>{article.author}</span>}
            <time dateTime={new Date(article.publishedAt).toISOString()}>
              {formatDate(article.publishedAt)}
            </time>
          </p>
        </header>

        {article.youtubeId && (
          <section className="video-card" aria-label="Video">
            {showEmbed ? (
              <div className="video-card__frame">
                <iframe
                  src={embedUrl(article.youtubeId)}
                  title="YouTube video player"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            ) : (
              <a
                className="video-card__link"
                href={watchUrl(article.youtubeId)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <div className="video-card__poster">
                  <img
                    src={thumbnailUrl(article.youtubeId)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                  <span className="video-card__play" aria-hidden="true">
                    <Icon name="play" size={22} />
                  </span>
                </div>
                <div className="video-card__footer">
                  <span className="video-card__text">
                    <strong>Watch on YouTube</strong>
                    <span>Opens in a new tab</span>
                  </span>
                  <Icon name="external" size={16} />
                </div>
              </a>
            )}
          </section>
        )}

        {article.audioUrl && (
          <section className="audio-card" aria-label="Episode audio">
            <audio controls preload="none" src={article.audioUrl}>
              <a href={article.audioUrl} target="_blank" rel="noopener noreferrer">
                Download the audio
              </a>
            </audio>
          </section>
        )}

        <div
          className="content"
          // Sanitized immediately before injection (src/lib/sanitize.ts).
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {!html && !article.youtubeId && !article.audioUrl && (
          <p className="detail__fallback">
            This article has no readable content.
            {article.link && (
              <>
                {' '}
                <a href={article.link} target="_blank" rel="noopener noreferrer">
                  Open the original
                </a>
                .
              </>
            )}
          </p>
        )}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />
      )}
    </article>
  );
}
