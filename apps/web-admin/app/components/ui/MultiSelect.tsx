import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

export type MultiSelectOption = Readonly<{
  value: string;
  label: string;
  disabled?: boolean;
}>;

export type MultiSelectProps = Readonly<{
  label?: string;
  placeholder?: string;

  options: readonly MultiSelectOption[];
  value: readonly string[];
  onChange: (next: string[]) => void;

  disabled?: boolean;
  maxSelected?: number;

  filterable?: boolean;

  /** Allow creating a new option when filter yields no matches. */
  creatable?: boolean;
  onCreateOption?: (label: string) => MultiSelectOption | null;

  className?: string;
}>;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function MultiSelect(props: MultiSelectProps) {
  const {
    label = 'Select',
    placeholder = 'Select…',
    options,
    value,
    onChange,
    disabled,
    maxSelected,
    filterable = true,
    creatable = false,
    onCreateOption,
    className,
  } = props;

  const inputId = useId();
  const listboxId = useId();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const selectedSet = useMemo(() => new Set(value), [value]);

  const selectedOptions = useMemo(
    () => options.filter((o) => selectedSet.has(o.value)),
    [options, selectedSet]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base =
      q && filterable ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

    return base;
  }, [filterable, options, query]);

  const canSelectMore = maxSelected ? value.length < maxSelected : true;

  const toggleValue = useCallback(
    (v: string) => {
      if (disabled) return;
      const next = new Set(value);
      if (next.has(v)) {
        next.delete(v);
        onChange(Array.from(next));
        return;
      }
      if (!canSelectMore) return;
      next.add(v);
      onChange(Array.from(next));
    },
    [canSelectMore, disabled, onChange, value]
  );

  const removeValue = useCallback(
    (v: string) => {
      if (disabled) return;
      const next = value.filter((x) => x !== v);
      onChange(next);
    },
    [disabled, onChange, value]
  );

  useEffect(() => {
    if (!open) {
      setActiveIndex(-1);
      return;
    }
    setActiveIndex((idx) => clamp(idx, -1, Math.max(-1, filtered.length - 1)));
  }, [filtered.length, open]);

  const showCreate =
    creatable &&
    Boolean(query.trim()) &&
    filtered.length === 0 &&
    typeof onCreateOption === 'function' &&
    canSelectMore;

  return (
    <div className={className}>
      <label htmlFor={inputId} className="text-caption text-muted">
        {label}
      </label>

      <div
        className={
          'mt-1 rounded-md border bg-background p-2 text-sm focus-within:ring-2 focus-within:ring-ring ' +
          (disabled ? 'opacity-60' : '')
        }
        onMouseDown={(e) => {
          // Keep focus within control when clicking on container.
          e.preventDefault();
          inputRef.current?.focus();
          if (!disabled) setOpen(true);
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          {selectedOptions.map((o) => (
            <span
              key={o.value}
              className="inline-flex items-center gap-1 rounded-md border bg-muted/20 px-2 py-1"
            >
              <span className="max-w-48 truncate">{o.label}</span>
              <button
                type="button"
                aria-label={`Remove ${o.label}`}
                className="rounded px-1 hover:bg-muted/30"
                disabled={disabled}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  removeValue(o.value);
                }}
              >
                ×
              </button>
            </span>
          ))}

          <input
            id={inputId}
            ref={inputRef}
            value={query}
            disabled={disabled}
            placeholder={selectedOptions.length === 0 ? placeholder : ''}
            className="min-w-24 flex-1 bg-transparent outline-none"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            onFocus={() => {
              if (!disabled) setOpen(true);
            }}
            onBlur={(e) => {
              const next = e.relatedTarget as HTMLElement | null;
              if (next?.dataset?.['multiSelectOption'] === 'true') return;
              setOpen(false);
              setQuery('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && query.length === 0 && value.length > 0) {
                e.preventDefault();
                removeValue(value[value.length - 1] ?? '');
                return;
              }

              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
                setActiveIndex((idx) => clamp(idx + 1, 0, Math.max(0, filtered.length - 1)));
                return;
              }

              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setOpen(true);
                setActiveIndex((idx) => clamp(idx - 1, 0, Math.max(0, filtered.length - 1)));
                return;
              }

              if (e.key === 'Enter') {
                if (open && activeIndex >= 0 && activeIndex < filtered.length) {
                  e.preventDefault();
                  toggleValue(filtered[activeIndex]?.value ?? '');
                } else if (showCreate) {
                  e.preventDefault();
                  const created = onCreateOption?.(query.trim());
                  if (created) {
                    toggleValue(created.value);
                    setQuery('');
                  }
                }
                return;
              }

              if (e.key === 'Escape') {
                setOpen(false);
                setQuery('');
                setActiveIndex(-1);
              }
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(-1);
            }}
          />
        </div>
      </div>

      {open ? (
        <div id={listboxId} role="listbox" className="relative" aria-label={`${label} options`}>
          <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-background shadow">
            {showCreate ? (
              <button
                type="button"
                data-multi-select-option="true"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/20"
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => {
                  const created = onCreateOption?.(query.trim());
                  if (created) {
                    toggleValue(created.value);
                    setQuery('');
                  }
                }}
              >
                Create “{query.trim()}”
              </button>
            ) : null}

            {filtered.slice(0, 50).map((o, idx) => {
              const checked = selectedSet.has(o.value);
              const active = idx === activeIndex;
              const optionDisabled = Boolean(o.disabled) || (!checked && !canSelectMore);

              return (
                <button
                  key={o.value}
                  type="button"
                  data-multi-select-option="true"
                  role="option"
                  aria-selected={checked}
                  disabled={disabled === true || optionDisabled}
                  className={
                    'flex w-full items-center justify-between px-3 py-2 text-left text-sm ' +
                    (active ? 'bg-muted/40' : 'hover:bg-muted/20') +
                    (optionDisabled ? ' opacity-60' : '')
                  }
                  onMouseEnter={() => setActiveIndex(idx)}
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => toggleValue(o.value)}
                >
                  <span className="truncate">{o.label}</span>
                  <span aria-hidden="true" className="font-mono text-xs text-muted">
                    {checked ? '✓' : ''}
                  </span>
                </button>
              );
            })}

            {filtered.length === 0 && !showCreate ? (
              <div className="px-3 py-2 text-sm text-muted">No results</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
