import { useEffect, useMemo, useRef, useState } from 'react';
import type { Feed } from '../types';
import { store } from '../store/store';
import { useStore } from '../hooks/useStore';
import { sanitizeHtml } from '../lib/sanitize';
import { formatDate } from '../lib/format';
import { copyText } from '../lib/clipboard';
import { thumbnailUrl, watchUrl } from '../lib/youtube';
import { detectEmbed, detectEmbedInHtml, type MediaEmbed } from '../lib/embeds';
import { cachedFullContent, fetchFullContent } from '../lib/fullContent';
import { t } from '../lib/i18n';
import { Icon } from './Icon';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

type DetailMenu =
  | { kind: 'article'; x: number; y: number }
  | { kind: 'link'; x: number; y: number; href: string; text: string };

export function ArticleDetail() {
  const state = useStore();
  const [menu, setMenu] = useState<DetailMenu | null>(null);
  /** A provider link clicked inside the article body, played above the text. */
  const [inlineMedia, setInlineMedia] = useState<MediaEmbed | null>(null);
  /** Reader-extracted page content, per article, toggled over the feed body. */
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [showFullContent, setShowFullContent] = useState(false);
  const [loadingFullContent, setLoadingFullContent] = useState(false);
  /** Invalidates an in-flight extraction when the reader moves to another article. */
  const fullContentRequest = useRef(0);
  const mediaRef = useRef<HTMLElement>(null);

  const article = useMemo(
    () => Object.values(state.articles).flat().find((a) => a.id === state.ui.activeArticleId),
    [state.articles, state.ui.activeArticleId]
  );
  const feed: Feed | undefined = article
    ? state.feeds.find((f) => f.id === article.feedId)
    : undefined;

  const html = useMemo(() => {
    if (!article) return '';
    if (showFullContent && fullContent) return fullContent;
    const base = article.link || feed?.siteUrl || feed?.url;
    return sanitizeHtml(article.contentHtml, base);
  }, [article, feed, fullContent, showFullContent]);

  // The item's own link wins; otherwise the first supported provider linked
  // from the body (Spotify in prose, a Vimeo clip in a paragraph…).
  const detectedMedia = useMemo(
    () => (article ? detectEmbed(article.link) ?? detectEmbedInHtml(article.contentHtml) : null),
    [article]
  );

  // A player opened from one article must not follow you to the next one.
  useEffect(() => {
    fullContentRequest.current += 1;
    setInlineMedia(null);
    setFullContent(article?.link ? cachedFullContent(article.link) ?? null : null);
    setShowFullContent(false);
    setLoadingFullContent(false);
  }, [article?.id, article?.link]);

  if (!article) {
    return (
      <div className="detail detail--empty">
        <div className="empty-state">
          <Icon name="book" size={38} />
          <h2>{t('No article selected')}</h2>
          <p>{t('Choose an article from the list to read it here.')}</p>
        </div>
      </div>
    );
  }

  const read = Boolean(state.readIds[article.id]);
  const starred = Boolean(state.starredIds[article.id]);
  const showEmbed = state.prefs.embedMedia;
  const embed = inlineMedia ?? detectedMedia;

  /**
   * A link to a supported provider plays in place instead of navigating away.
   * Modifier-clicks and the “play media inline” setting being off keep the
   * normal new-tab behaviour.
   */
  const playMediaLink = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!showEmbed) return;
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as HTMLElement).closest('a[href]');
    if (!anchor) return;
    const target = detectEmbed(anchor.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    setInlineMedia(target);
    requestAnimationFrame(() => {
      mediaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };

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

  const copyValue = async (value: string, labelKey: string) => {
    const label = t(labelKey);
    const ok = await copyText(value);
    store.notify(
      ok ? 'success' : 'error',
      ok
        ? t('{label} copied to the clipboard', { label })
        : t('Could not copy {label}', { label: label.toLowerCase() })
    );
  };

  const toggleFullContent = async () => {
    if (!article.link) return;
    if (fullContent) {
      setShowFullContent((value) => !value);
      return;
    }

    const request = ++fullContentRequest.current;
    setLoadingFullContent(true);
    try {
      const next = await fetchFullContent(article.link);
      if (
        request !== fullContentRequest.current ||
        store.getSnapshot().ui.activeArticleId !== article.id
      ) {
        return;
      }
      setFullContent(next);
      setShowFullContent(true);
      store.notify('success', t('Loaded the original article content'));
    } catch (err) {
      if (
        request !== fullContentRequest.current ||
        store.getSnapshot().ui.activeArticleId !== article.id
      ) {
        return;
      }
      store.notify(
        'error',
        err instanceof Error ? err.message : t('Could not load the original article content.')
      );
    } finally {
      if (request === fullContentRequest.current) setLoadingFullContent(false);
    }
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
          label: t('Copy link address'),
          onSelect: () => void copyValue(menu.href, 'Link'),
        },
        {
          icon: 'copy',
          label: t('Copy link text'),
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
        label: t('Copy article link'),
        onSelect: () => void copyValue(article.link as string, 'Article link'),
      });
    }
    items.push({
      icon: 'copy',
      label: t('Copy title'),
      onSelect: () => void copyValue(article.title, 'Title'),
    });
    items.push({
      icon: read ? 'eyeOff' : 'eye',
      label: t(read ? 'Mark as unread' : 'Mark as read'),
      onSelect: () => store.toggleRead(article.id),
    });
    items.push({
      icon: starred ? 'starFilled' : 'star',
      label: t(starred ? 'Unstar article' : 'Star article'),
      onSelect: () => store.toggleStar(article.id),
    });
    if (feed) {
      items.push({ type: 'divider' });
      items.push({
        icon: 'rss',
        label: t('Show only {feed}', { feed: feed.title }),
        onSelect: () => store.setActiveFeed(feed.id),
      });
    }
    return items;
  };

  return (
    <article className="detail" onContextMenu={handleContextMenu}>
      <div className="detail__bar">
        <div className="detail__actions">
          <button
            type="button"
            className={`ghost-button ${starred ? 'is-starred' : ''}`}
            onClick={() => store.toggleStar(article.id)}
            aria-pressed={starred}
            aria-label={t(starred ? 'Unstar article' : 'Star article')}
          >
            <Icon name={starred ? 'starFilled' : 'star'} size={16} />
            <span>{t(starred ? 'Starred' : 'Star')}</span>
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => store.toggleRead(article.id)}
            aria-label={t(read ? 'Mark as unread' : 'Mark as read')}
          >
            <Icon name={read ? 'eyeOff' : 'eye'} size={16} />
            <span>{t(read ? 'Unread' : 'Read')}</span>
          </button>

          {article.link && (
            <button
              type="button"
              className="ghost-button"
              onClick={() => void copyValue(article.link as string, 'Article link')}
              aria-label={t('Copy article link')}
            >
              <Icon name="copy" size={16} />
              <span>{t('Copy link')}</span>
            </button>
          )}

          {article.link && (
            <button
              type="button"
              className={`ghost-button ${showFullContent ? 'is-active' : ''}`}
              onClick={() => void toggleFullContent()}
              disabled={loadingFullContent}
              aria-pressed={showFullContent}
              aria-label={t(showFullContent ? 'Show feed content' : 'Load full article content')}
              title={
                showFullContent
                  ? t('Show the feed\'s own content')
                  : t('Fetch and extract the original article text')
              }
            >
              <Icon name="book" size={16} />
              <span>
                {loadingFullContent
                  ? t('Loading…')
                  : showFullContent
                    ? t('Full content')
                    : t('Load full content')}
              </span>
            </button>
          )}

          {article.link && (
            <a
              className="ghost-button"
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('Open original article in a new tab')}
            >
              <Icon name="external" size={16} />
              <span>{t('Original')}</span>
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

        {embed && (
          <section
            className={`media-card media-card--${embed.provider}`}
            aria-label={`${embed.label} player`}
            ref={mediaRef}
          >
            {showEmbed ? (
              <div
                className={`media-card__frame media-card__frame--${embed.layout}`}
                style={
                  embed.layout === 'audio' ? { height: `${embed.height ?? 166}px` } : undefined
                }
              >
                <iframe
                  src={embed.src}
                  title={`${embed.label} player`}
                  allow={embed.allow}
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            ) : embed.provider === 'youtube' ? (
              <a
                className="media-card__link"
                href={watchUrl(embed.id)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <div className="media-card__poster">
                  <img
                    src={thumbnailUrl(embed.id)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                  <span className="media-card__play" aria-hidden="true">
                    <Icon name="play" size={22} />
                  </span>
                </div>
                <div className="media-card__footer">
                  <span className="media-card__text">
                    <strong>{t('Watch on YouTube')}</strong>
                    <span>{t('Opens in a new tab')}</span>
                  </span>
                  <Icon name="external" size={16} />
                </div>
              </a>
            ) : (
              <a
                className="media-card__link media-card__link--compact"
                href={embed.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="media-card__play" aria-hidden="true">
                  <Icon name={embed.layout === 'video' ? 'play' : 'music'} size={18} />
                </span>
                <span className="media-card__compact-text">
                  <strong>{t('Play on {label}', { label: embed.label })}</strong>
                  <span>{t('Opens in a new tab')}</span>
                </span>
                <Icon name="external" size={16} />
              </a>
            )}

            <div className="media-card__meta">
              <span className="media-card__provider">{embed.label}</span>
              <a href={embed.href} target="_blank" rel="noopener noreferrer">
                Open in {embed.label}
              </a>
              {inlineMedia && (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setInlineMedia(null)}
                >
                  {t('Close player')}
                </button>
              )}
            </div>
          </section>
        )}

        {article.audioUrl && (
          <section className="audio-card" aria-label={t('Episode audio')}>
            <audio controls preload="none" src={article.audioUrl}>
              <a href={article.audioUrl} target="_blank" rel="noopener noreferrer">
                {t('Download the audio')}
              </a>
            </audio>
          </section>
        )}

        <div
          className="content"
          onClick={playMediaLink}
          // Sanitized immediately before injection (src/lib/sanitize.ts).
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {!html && !embed && !article.audioUrl && (
          <p className="detail__fallback">
            {t('This article has no readable content.')}
            {article.link && (
              <>
                {' '}
                <a href={article.link} target="_blank" rel="noopener noreferrer">
                  {t('Open the original')}
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
