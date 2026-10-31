import { describe, expect, it } from 'vitest';
import { plural, resolveLocale, setLocale, t } from './i18n';

describe('i18n', () => {
  it('resolves the system locale to Spanish only for Spanish languages', () => {
    expect(resolveLocale('system', 'es-ES')).toBe('es');
    expect(resolveLocale('system', 'es')).toBe('es');
    expect(resolveLocale('system', 'en-US')).toBe('en');
    expect(resolveLocale('system', 'fr-FR')).toBe('en');
  });

  it('honours an explicit preference over the navigator language', () => {
    expect(resolveLocale('en', 'es-ES')).toBe('en');
    expect(resolveLocale('es', 'en-US')).toBe('es');
  });

  it('falls back to the English source string for unknown keys', () => {
    setLocale('es');
    expect(t('A key that does not exist')).toBe('A key that does not exist');
    expect(t('Settings')).toBe('Ajustes');
  });

  it('interpolates variables and plurals', () => {
    setLocale('es');
    expect(t('{count} unread', { count: 3 })).toBe('3 sin leer');
    expect(plural(1, '{count} article', '{count} articles')).toBe('1 artículo');
    expect(plural(4, '{count} article', '{count} articles')).toBe('4 artículos');
    setLocale('en');
    expect(plural(2, '{count} article', '{count} articles')).toBe('2 articles');
  });
});
