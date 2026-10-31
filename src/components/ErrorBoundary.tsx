import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../lib/i18n';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort UI boundary. A malformed article should not blank the whole
 * reader; the local database is untouched, so reloading recovers.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="app-error" role="alert">
        <div className="app-error__panel">
          <h1>{t('Something went wrong')}</h1>
          <p>
            {t('The reader hit an unexpected UI error. Your subscriptions and read state are still saved on this device.')}
          </p>
          <pre>{error.message}</pre>
          <button
            type="button"
            className="button button--primary"
            onClick={() => window.location.reload()}
          >
            {t('Reload')}
          </button>
        </div>
      </div>
    );
  }
}
