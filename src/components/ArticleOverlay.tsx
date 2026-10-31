import { store } from '../store/store';
import { useStore } from '../hooks/useStore';
import { useVisibleArticles } from '../hooks/useVisibleArticles';
import { leaveArticle } from '../lib/viewHistory';
import { ArticleDetail } from './ArticleDetail';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { t } from '../lib/i18n';

/** Card-view reader: blurred backdrop, previous/next arrows and close. */
export function ArticleOverlay() {
  const state = useStore();

  const articles = useVisibleArticles(state);

  const article = Object.values(state.articles)
    .flat()
    .find((item) => item.id === state.ui.activeArticleId);
  if (!article) return null;

  const index = articles.findIndex((item) => item.id === article.id);
  const previous = index > 0 ? articles[index - 1] : null;
  const next = index >= 0 && index < articles.length - 1 ? articles[index + 1] : null;

  const open = (id: string) => {
    if (!state.readIds[id]) store.toggleRead(id);
    store.setActiveArticle(id);
  };

  return (
    <Dialog
      open
      onClose={leaveArticle}
      title=""
      bare
      ariaLabel={article.title}
      size="lg"
      className="article-overlay__dialog"
      backdropClassName="article-overlay__backdrop"
    >
      <button
        type="button"
        className="article-overlay__nav article-overlay__nav--prev"
        onClick={() => previous && open(previous.id)}
        disabled={!previous}
        aria-label={t('Previous article')}
        title={t('Previous article')}
      >
        <Icon name="back" size={20} />
      </button>
      <button
        type="button"
        className="article-overlay__nav article-overlay__nav--next"
        onClick={() => next && open(next.id)}
        disabled={!next}
        aria-label={t('Next article')}
        title={t('Next article')}
      >
        <Icon name="chevronRight" size={20} />
      </button>

      <ArticleDetail />
    </Dialog>
  );
}
