import { useMemo } from 'react';
import type { Feed } from '../types';
import { store } from '../store/store';
import { useStore } from '../hooks/useStore';
import { sanitizeHtml } from '../lib/sanitize';
import { formatDate } from '../lib/format';
import { embedUrl, thumbnailUrl, watchUrl } from '../lib/youtube';
import { Icon } from './Icon';

export function ArticleDetail() {
  const state = useStore();

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

  return (
    <article className="detail">
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

        <div
          className="content"
          // Sanitized immediately before injection (src/lib/sanitize.ts).
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {!html && !article.youtubeId && (
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
    </article>
  );
}
