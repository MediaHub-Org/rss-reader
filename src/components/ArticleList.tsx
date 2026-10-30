import { useMemo, useState } from 'react';
import type { Article, Feed } from '../types';
import { store, selectArticles } from '../store/store';
import { useStore, useInfiniteList } from '../hooks/useStore';
import { formatRelativeTime } from '../lib/format';
import { thumbnailUrl } from '../lib/youtube';
import { detectEmbed, detectEmbedInHtml } from '../lib/embeds';
import { copyText } from '../lib/clipboard';
import { FeedIcon } from './FeedIcon';
import { Icon } from './Icon';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

const PAGE_SIZE = 30;

interface ArticleListProps {
  onAddFeed: () => void;
  onImport: () => void;
}

export function ArticleList({ onAddFeed, onImport }: ArticleListProps) {
  const state = useStore();
  const [menu, setMenu] = useState<{ x: number; y: number; article: Article } | null>(null);

  const articles = useMemo(
    () =>
      selectArticles(state, {
        feedId: state.ui.activeFeedId,
        sort: state.ui.sort,
        query: state.ui.query,
        filter: state.prefs.articleFilter,
        caseSensitive: state.prefs.searchCaseSensitive,
        fullText: state.prefs.searchFullText,
        searchAll: state.ui.searchAllFeeds,
      }),
    [state]
  );

  const feedsById = useMemo(
    () => new Map<string, Feed>(state.feeds.map((feed) => [feed.id, feed])),
    [state.feeds]
  );

  const { visible, sentinelRef, loadMore } = useInfiniteList(articles.length, PAGE_SIZE);
  const slice = articles.slice(0, visible);

  const openArticle = (article: Article) => {
    if (!state.readIds[article.id]) store.toggleRead(article.id);
    store.setActiveArticle(article.id);
  };

  const copyValue = async (value: string, label: string) => {
    const ok = await copyText(value);
    store.notify(
      ok ? 'success' : 'error',
      ok ? `${label} copied to the clipboard` : `Could not copy ${label.toLowerCase()}`
    );
  };

  const menuItems = (article: Article): ContextMenuItem[] => {
    const read = Boolean(state.readIds[article.id]);
    const starred = Boolean(state.starredIds[article.id]);
    const feed = feedsById.get(article.feedId);
    const items: ContextMenuItem[] = [
      { icon: 'book', label: 'Open article', onSelect: () => openArticle(article) },
    ];
    if (article.link) {
      items.push({
        icon: 'external',
        label: 'Open original in new tab',
        onSelect: () => window.open(article.link, '_blank', 'noopener,noreferrer'),
      });
    }
    items.push({
      icon: read ? 'eyeOff' : 'eye',
      label: read ? 'Mark as unread' : 'Mark as read',
      onSelect: () => store.toggleRead(article.id),
    });
    items.push({
      icon: starred ? 'starFilled' : 'star',
      label: starred ? 'Unstar article' : 'Star article',
      onSelect: () => store.toggleStar(article.id),
    });
    if (article.link) {
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
    <div className={`list list--${state.prefs.viewMode}`} role="feed" aria-label="Articles">
      <ul className={`article-grid article-grid--${state.prefs.viewMode}`}>
        {slice.map((article) => (
          <ArticleCard
            key={article.id}
            article={article}
            feed={feedsById.get(article.feedId)}
            read={Boolean(state.readIds[article.id])}
            starred={Boolean(state.starredIds[article.id])}
            active={state.ui.activeArticleId === article.id}
            onMenu={(target, x, y) => setMenu({ article: target, x, y })}
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

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.article)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

interface ArticleCardProps {
  article: Article;
  feed?: Feed;
  read: boolean;
  starred: boolean;
  active: boolean;
  onMenu: (article: Article, x: number, y: number) => void;
}

function ArticleCard({ article, feed, read, starred, active, onMenu }: ArticleCardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const time = formatRelativeTime(article.publishedAt);
  // Same detection as the reader panel, so the card and the detail agree on
  // whether something will play in place.
  const embed = useMemo(
    () => detectEmbed(article.link) ?? detectEmbedInHtml(article.contentHtml),
    [article.link, article.contentHtml]
  );

  // YouTube items always have an i.ytimg.com thumbnail even when the feed XML
  // omitted <media:thumbnail>; regular items use the extracted image.
  const rawThumb = article.youtubeId
    ? thumbnailUrl(article.youtubeId)
    : article.thumbnail;
  const thumb = imgFailed ? undefined : rawThumb;
  const videoEmbed = article.youtubeId !== undefined || embed?.layout === 'video';
  const audioEmbed = !videoEmbed && (Boolean(article.audioUrl) || embed?.layout === 'audio');
  // A provider card without artwork still qualifies as “has media”, so it gets
  // the band layout instead of the centred text-only treatment.
  const hasMediaBand = Boolean(thumb) || Boolean(embed);

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
          starred ? 'is-starred' : '',
          active ? 'is-active' : '',
          hasMediaBand ? 'has-media' : 'no-media',
          videoEmbed ? 'article-card--video' : '',
          audioEmbed ? 'article-card--audio' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-article-id={article.id}
        tabIndex={0}
        role="link"
        aria-label={`${article.title}${read ? ' (read)' : ' (unread)'}`}
        aria-current={active ? 'true' : undefined}
        onClick={open}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onMenu(article, event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        }}
      >
        {thumb ? (
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
            {videoEmbed && (
              <span className="article-card__play" title="Video player" aria-hidden="true">
                <Icon name="play" size={18} />
              </span>
            )}
            {audioEmbed && (
              <span className="article-card__play" title="Audio player" aria-hidden="true">
                <Icon name="music" size={18} />
              </span>
            )}
          </div>
        ) : embed ? (
          // Providers don't always ship an image, but the card should still look
          // like something you can play rather than like a text-only item.
          <div
            className={`article-card__media article-card__media--embed article-card__media--${embed.provider}`}
          >
            <span className="article-card__embed-icon" aria-hidden="true">
              <Icon name={embed.layout === 'video' ? 'play' : 'music'} size={20} />
            </span>
            <span className="article-card__embed-label">{embed.label}</span>
          </div>
        ) : null}

        <div className="article-card__info">
          {feed && <FeedIcon feed={feed} className="article-card__favicon" />}
          <span className="article-card__feed">{feed?.title ?? 'Feed'}</span>
          {starred && (
            <span className="article-card__star" title="Starred" aria-label="Starred">
              <Icon name="starFilled" size={12} />
            </span>
          )}
          {embed && (
            <span
              className="article-card__media-chip"
              title={`Plays inline · ${embed.label}`}
              aria-label={embed.label}
            >
              <Icon name={embed.layout === 'video' ? 'play' : 'music'} size={11} />
            </span>
          )}
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
