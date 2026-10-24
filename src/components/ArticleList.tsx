import { useMemo, useState } from 'react';
import type { Article, Feed } from '../types';
import { store, selectArticles } from '../store/store';
import { useStore, useInfiniteList } from '../hooks/useStore';
import { formatRelativeTime } from '../lib/format';
import { thumbnailUrl } from '../lib/youtube';
import { FeedIcon } from './FeedIcon';
import { Icon } from './Icon';

const PAGE_SIZE = 30;

interface ArticleListProps {
  onAddFeed: () => void;
  onImport: () => void;
}

export function ArticleList({ onAddFeed, onImport }: ArticleListProps) {
  const state = useStore();

  const articles = useMemo(
    () =>
      selectArticles(state, {
        feedId: state.ui.activeFeedId,
        sort: state.ui.sort,
        query: state.ui.query,
        hideRead: state.prefs.hideRead,
      }),
    [state]
  );

  const feedsById = useMemo(
    () => new Map<string, Feed>(state.feeds.map((feed) => [feed.id, feed])),
    [state.feeds]
  );

  const { visible, sentinelRef, loadMore } = useInfiniteList(articles.length, PAGE_SIZE);
  const slice = articles.slice(0, visible);

  if (!state.hydrated) {
    return (
      <div className="list list--loading" aria-busy="true" aria-live="polite">
        <p className="sr-only">Loading feeds</p>
        <div className="article-grid">
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="skeleton-card" key={index} />
          ))}
        </div>
      </div>
    );
  }

  if (!state.feeds.length) {
    return (
      <div className="empty-state">
        <Icon name="rss" size={40} />
        <h2>Welcome</h2>
        <p>Add an RSS or Atom feed URL to start reading. You can also import an OPML file.</p>
        <div className="empty-state__actions">
          <button type="button" className="button button--primary" onClick={onAddFeed}>
            Add feed
          </button>
          <button type="button" className="button button--ghost" onClick={onImport}>
            Import OPML
          </button>
        </div>
      </div>
    );
  }

  if (!articles.length) {
    const searching = state.ui.query.trim().length > 0;
    return (
      <div className="list">
        <div className="empty-state">
          <Icon name={searching ? 'search' : 'inbox'} size={38} />
          <h2>{searching ? 'No matches' : 'Nothing here yet'}</h2>
          <p>
            {searching
              ? 'No articles match your search in this view.'
              : 'Refresh your feeds, or check back later for new articles.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="list" role="feed" aria-label="Articles">
      <ul className="article-grid">
        {slice.map((article) => (
          <ArticleCard
            key={article.id}
            article={article}
            feed={feedsById.get(article.feedId)}
            read={Boolean(state.readIds[article.id])}
            active={state.ui.activeArticleId === article.id}
          />
        ))}
      </ul>

      {visible < articles.length ? (
        <div className="list__more" ref={sentinelRef}>
          <button type="button" className="button button--ghost" onClick={loadMore}>
            Load more ({articles.length - visible} remaining)
          </button>
        </div>
      ) : (
        <p className="list__end">End of list · {articles.length} articles</p>
      )}
    </div>
  );
}

interface ArticleCardProps {
  article: Article;
  feed?: Feed;
  read: boolean;
  active: boolean;
}

function ArticleCard({ article, feed, read, active }: ArticleCardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const time = formatRelativeTime(article.publishedAt);

  // YouTube items always have an i.ytimg.com thumbnail even when the feed XML
  // omitted <media:thumbnail>; regular items use the extracted image.
  const rawThumb = article.youtubeId
    ? thumbnailUrl(article.youtubeId)
    : article.thumbnail;
  const thumb = imgFailed ? undefined : rawThumb;

  const open = () => {
    if (!read) store.toggleRead(article.id);
    store.setActiveArticle(article.id);
  };

  return (
    <li className="article-grid__item">
      <article
        className={[
          'article-card',
          read ? 'is-read' : '',
          active ? 'is-active' : '',
          thumb ? 'has-media' : 'no-media',
          article.youtubeId ? 'article-card--video' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-article-id={article.id}
        tabIndex={0}
        role="link"
        aria-label={`${article.title}${read ? ' (read)' : ' (unread)'}`}
        aria-current={active ? 'true' : undefined}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        }}
      >
        {thumb && (
          <div className="article-card__media">
            <img
              className="article-card__img"
              src={thumb}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
            />
            {article.youtubeId && (
              <span className="article-card__play" title="YouTube video" aria-hidden="true">
                <Icon name="play" size={18} />
              </span>
            )}
          </div>
        )}

        <div className="article-card__info">
          {feed && <FeedIcon feed={feed} className="article-card__favicon" />}
          <span className="article-card__feed">{feed?.title ?? 'Feed'}</span>
          {!read && <span className="article-card__unread" aria-hidden="true" />}
          <time className="article-card__time" dateTime={new Date(article.publishedAt).toISOString()}>
            {time}
          </time>
          <button
            type="button"
            className="icon-button article-card__toggle"
            onClick={(event) => {
              event.stopPropagation();
              store.toggleRead(article.id);
            }}
            aria-label={read ? 'Mark as unread' : 'Mark as read'}
            title={read ? 'Mark as unread' : 'Mark as read'}
          >
            <Icon name={read ? 'eyeOff' : 'eye'} size={14} />
          </button>
        </div>

        <h3 className="article-card__title">{article.title}</h3>
        {article.summary && <p className="article-card__snippet">{article.summary}</p>}
      </article>
    </li>
  );
}
