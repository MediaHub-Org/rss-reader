import type { Article, ArticleRule, Feed, RuleAction, RuleField, RuleMatchMode } from '../types';
import { rawSearchableText } from './search';

const SCOPES = ['all'] as const;

/** Rule scope that applies to every source and every group. */
export const ALL_RULE_SCOPE = 'all';

export function ruleId(): string {
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isRuleAction(value: unknown): value is RuleAction {
  return value === 'read' || value === 'star';
}

function isRuleField(value: unknown): value is RuleField {
  return value === 'title' || value === 'content';
}

function isMatchMode(value: unknown): value is RuleMatchMode {
  return value === 'contains' || value === 'regex';
}

function validScope(value: unknown): string | null {
  if (value === undefined || value === null) return ALL_RULE_SCOPE;
  if (typeof value !== 'string') return null;
  if ((SCOPES as readonly string[]).includes(value)) return value;
  if (value.startsWith('feed:') && value.length > 'feed:'.length) return value;
  if (value.startsWith('group:') && value.length > 'group:'.length) return value;
  return null;
}

/**
 * Validate a rule coming from storage or a backup. Returns null for entries
 * that could never do anything (no pattern, or no actions).
 */
export function parseRule(raw: unknown): ArticleRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const pattern = typeof value.pattern === 'string' ? value.pattern : '';
  if (!pattern.trim()) return null;

  const actions = Array.isArray(value.actions)
    ? [...new Set(value.actions.filter(isRuleAction))] as RuleAction[]
    : [];
  if (!actions.length) return null;

  const scope = validScope(value.scope);
  if (!scope) return null;

  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id : ruleId(),
    enabled: value.enabled !== false,
    pattern,
    field: isRuleField(value.field) ? value.field : 'title',
    mode: isMatchMode(value.mode) ? value.mode : 'contains',
    negate: value.negate === true,
    actions,
    scope,
  };
}

export function parseRules(raw: unknown): ArticleRule[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseRule).filter((rule): rule is ArticleRule => rule !== null);
}

/** True when a regular-expression pattern compiles. */
export function isValidPattern(rule: Pick<ArticleRule, 'mode' | 'pattern'>): boolean {
  if (rule.mode !== 'regex') return true;
  try {
    new RegExp(rule.pattern, 'i');
    return true;
  } catch {
    return false;
  }
}

function scopeMatches(scope: string, article: Article, feeds: Feed[]): boolean {
  if (scope === ALL_RULE_SCOPE) return true;
  if (scope.startsWith('feed:')) return article.feedId === scope.slice('feed:'.length);
  if (scope.startsWith('group:')) {
    const group = scope.slice('group:'.length).trim();
    const feed = feeds.find((item) => item.id === article.feedId);
    return (feed?.folder ?? '').trim() === group;
  }
  return false;
}

/** Does one rule match one article? Invalid regexes never match. */
export function ruleMatchesArticle(article: Article, rule: ArticleRule, feeds: Feed[]): boolean {
  if (!rule.enabled || !rule.pattern.trim()) return false;
  if (!scopeMatches(rule.scope, article, feeds)) return false;

  const text =
    rule.field === 'title' ? article.title : rawSearchableText(article);

  let matched: boolean;
  if (rule.mode === 'regex') {
    try {
      matched = new RegExp(rule.pattern, 'i').test(text);
    } catch {
      return false;
    }
  } else {
    matched = text.toLowerCase().includes(rule.pattern.toLowerCase());
  }

  return rule.negate ? !matched : matched;
}

export interface RuleApplication {
  readIds: string[];
  starredIds: string[];
}

/**
 * Apply every enabled rule to the given articles. Rules cascade: article ids
 * can appear in both lists when different rules ask for different actions.
 */
export function applyRulesToArticles(
  articles: Article[],
  rules: ArticleRule[],
  feeds: Feed[]
): RuleApplication {
  const enabled = rules.filter((rule) => rule.enabled && rule.pattern.trim());
  if (!enabled.length) return { readIds: [], starredIds: [] };

  const read = new Set<string>();
  const starred = new Set<string>();

  for (const article of articles) {
    for (const rule of enabled) {
      if (!ruleMatchesArticle(article, rule, feeds)) continue;
      for (const action of rule.actions) {
        if (action === 'read') read.add(article.id);
        else starred.add(article.id);
      }
    }
  }

  return { readIds: [...read], starredIds: [...starred] };
}

/** Map a list of ids to the `Record<id, true>` shape used by AppState. */
export function idMap(ids: string[]): Record<string, true> {
  return Object.fromEntries(ids.map((id) => [id, true] as const));
}
