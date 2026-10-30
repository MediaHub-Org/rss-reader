import { useMemo, useState } from 'react';
import type { ArticleRule, RuleAction, RuleField, RuleMatchMode } from '../../types';
import { store } from '../../store/store';
import { useStore } from '../../hooks/useStore';
import { byName } from '../../lib/portability';
import { countLabel } from '../../lib/format';
import { isValidPattern, ruleId, ruleMatchesArticle } from '../../lib/rules';
import { Dropdown, type DropdownOption } from '../Dropdown';
import { Icon } from '../Icon';

const FIELD_OPTIONS: Array<DropdownOption<RuleField>> = [
  { value: 'title', label: 'Title' },
  { value: 'content', label: 'Title or content' },
];

const MODE_OPTIONS: Array<DropdownOption<RuleMatchMode>> = [
  { value: 'contains', label: 'contains' },
  { value: 'regex', label: 'matches regex' },
];

function scopeLabel(scope: string, feeds: ReturnType<typeof useStore>['feeds']): string {
  if (scope === 'all') return 'All sources';
  if (scope.startsWith('feed:')) {
    const feed = feeds.find((item) => item.id === scope.slice('feed:'.length));
    return feed ? `Source · ${feed.title}` : 'Missing source';
  }
  if (scope.startsWith('group:')) return `Group · ${scope.slice('group:'.length)}`;
  return 'All sources';
}

function actionLabel(actions: RuleAction[]): string {
  return actions
    .map((action) => (action === 'read' ? 'mark as read' : 'star'))
    .join(' and ');
}

/** Rules editor: regex/contains patterns with automatic read and star actions. */
export function RulesPanel() {
  const state = useStore();
  const [draft, setDraft] = useState<ArticleRule | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scopeOptions = useMemo<Array<DropdownOption<string>>>(() => {
    const groups = new Set(
      [...state.folders, ...state.feeds.map((feed) => feed.folder?.trim() ?? '')].filter(Boolean)
    );
    const options: Array<DropdownOption<string>> = [{ value: 'all', label: 'All sources' }];
    for (const group of [...groups].sort(byName)) {
      options.push({ value: `group:${group}`, label: `Group · ${group}` });
    }
    for (const feed of [...state.feeds].sort((a, b) => byName(a.title, b.title))) {
      options.push({ value: `feed:${feed.id}`, label: `Source · ${feed.title}` });
    }
    return options;
  }, [state.feeds, state.folders]);

  const draftMatches = useMemo(() => {
    if (!draft || !draft.pattern.trim() || !isValidPattern(draft)) return null;
    const test = { ...draft, enabled: true };
    return Object.values(state.articles)
      .flat()
      .filter((article) => ruleMatchesArticle(article, test, state.feeds)).length;
  }, [draft, state.articles, state.feeds]);

  const startNew = () => {
    setError(null);
    setDraft({
      id: ruleId(),
      enabled: true,
      pattern: '',
      field: 'title',
      mode: 'contains',
      negate: false,
      actions: ['read'],
      scope: 'all',
    });
  };

  const edit = (rule: ArticleRule) => {
    setError(null);
    setDraft({ ...rule, actions: [...rule.actions] });
  };

  const toggleAction = (action: RuleAction) => {
    if (!draft) return;
    const actions = draft.actions.includes(action)
      ? draft.actions.filter((item) => item !== action)
      : [...draft.actions, action];
    setDraft({ ...draft, actions });
  };

  const save = () => {
    if (!draft) return;
    const pattern = draft.pattern.trim();
    if (!pattern) {
      setError('Enter a word or regular expression to match.');
      return;
    }
    if (!draft.actions.length) {
      setError('Choose at least one action.');
      return;
    }
    if (!isValidPattern(draft)) {
      setError('That regular expression is invalid.');
      return;
    }

    const next = { ...draft, pattern };
    if (state.rules.some((rule) => rule.id === next.id)) store.updateRule(next.id, next);
    else store.addRule(next);
    setDraft(null);
    setError(null);
  };

  return (
    <section className="settings-section">
      <div className="settings-section__header">
        <div>
          <h2 className="settings-section__title">Automatic rules</h2>
          <p className="settings-note settings-note--tight">
            Rules run when new articles arrive. They can mark matching articles as read or star
            them, and cascade in order. Use “Apply to existing” to run them over the cache now.
          </p>
        </div>
        <button type="button" className="button button--primary" onClick={startNew}>
          <Icon name="plus" size={15} />
          <span>New rule</span>
        </button>
      </div>

      {!state.rules.length && !draft && (
        <p className="settings-empty">
          No rules yet. Create one to hide the noise from a busy source or to keep important
          stories.
        </p>
      )}

      {state.rules.length > 0 && (
        <ul className="rule-list">
          {state.rules.map((rule) => (
            <li key={rule.id} className={`rule-card ${rule.enabled ? '' : 'is-disabled'}`}>
              <button
                type="button"
                role="switch"
                aria-checked={rule.enabled}
                aria-label={`${rule.enabled ? 'Disable' : 'Enable'} rule ${rule.pattern}`}
                className={`switch switch--sm ${rule.enabled ? 'is-on' : ''}`}
                onClick={() => store.updateRule(rule.id, { enabled: !rule.enabled })}
              >
                <span className="switch__thumb" />
              </button>

              <div className="rule-card__body">
                <p className="rule-card__summary">
                  If {rule.field === 'title' ? 'the title' : 'the title or content'}{' '}
                  {rule.mode === 'regex' ? 'matches the regex' : 'contains'}{' '}
                  {rule.negate ? 'not ' : ''}
                  <code className="rule-card__pattern">{rule.pattern}</code> in{' '}
                  {scopeLabel(rule.scope, state.feeds)} → {actionLabel(rule.actions)}
                </p>
                <div className="rule-card__actions">
                  <button type="button" className="ghost-button" onClick={() => edit(rule)}>
                    <Icon name="pencil" size={14} />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    className="ghost-button rule-card__delete"
                    onClick={() => {
                      store.removeRule(rule.id);
                      store.notify('success', 'Rule deleted');
                    }}
                  >
                    <Icon name="trash" size={14} />
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <div className="rule-editor" role="group" aria-label="Rule editor">
          <div className="rule-editor__row">
            <span className="rule-editor__label">Apply to</span>
            <Dropdown<string>
              value={draft.scope}
              options={scopeOptions}
              onChange={(scope) => setDraft({ ...draft, scope })}
              label="Rule scope"
              className="rule-editor__dropdown"
            />
          </div>

          <div className="rule-editor__row rule-editor__row--wrap">
            <span className="rule-editor__label">Condition</span>
            <div className="rule-editor__condition">
              <Dropdown<RuleField>
                value={draft.field}
                options={FIELD_OPTIONS}
                onChange={(field) => setDraft({ ...draft, field })}
                label="Rule field"
                className="rule-editor__dropdown"
              />
              <Dropdown<RuleMatchMode>
                value={draft.mode}
                options={MODE_OPTIONS}
                onChange={(mode) => setDraft({ ...draft, mode })}
                label="Rule match mode"
                className="rule-editor__dropdown"
              />
              <input
                className="input rule-editor__pattern"
                placeholder={draft.mode === 'regex' ? 'e.g. \\bAI\\b' : 'e.g. bitcoin'}
                aria-label="Rule pattern"
                value={draft.pattern}
                onChange={(event) => setDraft({ ...draft, pattern: event.target.value })}
                spellCheck={false}
              />
              <label className="rule-check">
                <input
                  type="checkbox"
                  checked={draft.negate}
                  onChange={(event) => setDraft({ ...draft, negate: event.target.checked })}
                />
                <span>doesn&apos;t match</span>
              </label>
            </div>
          </div>

          <div className="rule-editor__row">
            <span className="rule-editor__label">Then</span>
            <div className="rule-editor__actions">
              <label className="rule-check">
                <input
                  type="checkbox"
                  checked={draft.actions.includes('read')}
                  onChange={() => toggleAction('read')}
                />
                <span>Mark as read</span>
              </label>
              <label className="rule-check">
                <input
                  type="checkbox"
                  checked={draft.actions.includes('star')}
                  onChange={() => toggleAction('star')}
                />
                <span>Star</span>
              </label>
            </div>
          </div>

          <p className="rule-editor__preview">
            {draftMatches === null
              ? 'Enter a valid pattern to preview matches.'
              : `Matches ${countLabel(draftMatches, 'cached article')}.`}
          </p>

          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}

          <div className="rule-editor__footer">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              Cancel
            </button>
            <button type="button" className="button button--primary" onClick={save}>
              Save rule
            </button>
          </div>
        </div>
      )}

      <div className="settings-data-actions">
        <button
          type="button"
          className="button button--ghost"
          onClick={() => {
            const changed = store.applyRulesNow();
            store.notify(
              changed ? 'success' : 'info',
              changed
                ? `Rules updated ${countLabel(changed, 'article state')}`
                : 'No cached articles matched the rules'
            );
          }}
          disabled={!state.rules.some((rule) => rule.enabled)}
        >
          <Icon name="refresh" size={15} />
          <span>Apply to existing articles</span>
        </button>
      </div>
    </section>
  );
}
