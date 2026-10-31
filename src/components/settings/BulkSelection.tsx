import { useEffect, useRef, useState } from 'react';
import { t } from '../../lib/i18n';

/** Accessible checkbox that can show the indeterminate “some selected” state. */
export function TriStateSelect({
  checked,
  indeterminate,
  onChange,
  label,
  ariaLabel,
  disabled,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  label: string;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className="manage-select-all">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={ariaLabel}
      />
      <span>{label}</span>
    </label>
  );
}

/**
 * Shared selection state for the Sources/Groups managers: it prunes ids that
 * disappear after a delete, and exposes the All / N selected / None label used
 * by the top-level tri-state control.
 */
export function useBulkSelection(ids: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const validIds = useRef(ids);
  validIds.current = ids;
  const idKey = ids.join('\u0000');

  useEffect(() => {
    const valid = new Set(validIds.current);
    setSelected((previous) => {
      const next = new Set([...previous].filter((id) => valid.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [idKey]);

  const allSelected = ids.length > 0 && selected.size === ids.length;
  const someSelected = selected.size > 0 && !allSelected;
  const label = allSelected
    ? t('All')
    : selected.size
      ? t('{count} selected', { count: selected.size })
      : t('None');

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleMany = (many: string[]) => {
    const all = many.length > 0 && many.every((id) => selected.has(id));
    setSelected((previous) => {
      const next = new Set(previous);
      for (const id of many) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(ids));
  };

  const clear = () => setSelected(new Set());

  return {
    selected,
    setSelected,
    clear,
    toggle,
    toggleMany,
    toggleAll,
    allSelected,
    someSelected,
    label,
  };
}
