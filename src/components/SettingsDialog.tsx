import { useState } from 'react';
import type { Density, FontSize, ThemeMode } from '../types';
import { store } from '../store/store';
import { useStore } from '../hooks/useStore';
import { clearArticleCache, estimateUsage } from '../lib/storage';
import { formatBytes } from '../lib/format';
import { Dialog } from './Dialog';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="setting-row">
      <span className="setting-row__label" id={`label-${label}`}>
        {label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={`label-${label}`}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={`segmented__option ${value === option.value ? 'is-active' : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <span className="setting-row__label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`switch ${checked ? 'is-on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch__thumb" />
      </button>
    </div>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const state = useStore();
  const [usage] = useState(() => estimateUsage());
  const [clearing, setClearing] = useState(false);

  const clearCache = async () => {
    setClearing(true);
    await clearArticleCache();
    setClearing(false);
    store.notify('success', 'Article cache cleared');
  };

  return (
    <Dialog open={open} onClose={onClose} title="Settings" size="md">
      <section className="settings-section">
        <h3 className="settings-section__title">Appearance</h3>

        <Segmented<ThemeMode>
          label="Theme"
          value={state.prefs.theme}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System' },
          ]}
          onChange={(theme) => store.setPreferences({ theme })}
        />

        <Segmented<Density>
          label="List density"
          value={state.prefs.density}
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ]}
          onChange={(density) => store.setPreferences({ density })}
        />

        <Segmented<FontSize>
          label="Reader font size"
          value={state.prefs.fontSize}
          options={[
            { value: 'small', label: 'Small' },
            { value: 'medium', label: 'Medium' },
            { value: 'large', label: 'Large' },
          ]}
          onChange={(fontSize) => store.setPreferences({ fontSize })}
        />
      </section>

      <section className="settings-section">
        <h3 className="settings-section__title">Reading</h3>

        <Toggle
          label="Embed YouTube videos"
          hint="When off, videos open in a new tab instead."
          checked={state.prefs.embedYouTube}
          onChange={(embedYouTube) => store.setPreferences({ embedYouTube })}
        />

        <Toggle
          label="Hide read articles"
          checked={state.prefs.hideRead}
          onChange={(hideRead) => store.setPreferences({ hideRead })}
        />
      </section>

      <section className="settings-section">
        <h3 className="settings-section__title">Data</h3>
        <div className="setting-row">
          <span className="setting-row__label">
            Local storage
            <small>
              {formatBytes(usage.used)} used · subscriptions, read status and article cache stay on this
              device
            </small>
          </span>
        </div>
        <div className="setting-row">
          <span className="setting-row__label">
            Clear cached articles
            <small>Removes downloaded content. Subscriptions and read state are kept.</small>
          </span>
          <button type="button" className="button button--ghost" onClick={() => void clearCache()} disabled={clearing}>
            {clearing ? 'Clearing…' : 'Clear cache'}
          </button>
        </div>
      </section>

      <p className="settings-note">
        Keyboard: <kbd>j</kbd>/<kbd>k</kbd> navigate · <kbd>o</kbd> open · <kbd>m</kbd> toggle read ·{' '}
        <kbd>r</kbd> refresh · <kbd>/</kbd> search · <kbd>Esc</kbd> back
      </p>
    </Dialog>
  );
}
