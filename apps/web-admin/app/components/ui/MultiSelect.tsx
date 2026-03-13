import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

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

  /** Plan API */
  maxItems?: number;
  searchable?: boolean;
  allowCreate?: boolean;

  /** Back-compat aliases */
  maxSelected?: number;
  filterable?: boolean;
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
    placeholder = 'Selectează…',
    options,
    value,
    onChange,
    disabled,
    maxItems,
    searchable,
    allowCreate,
    maxSelected,
    filterable,
    creatable,
    onCreateOption,
    className,
  } = props;

  const effectiveMax = maxItems ?? maxSelected;
  const effectiveSearchable = searchable ?? filterable ?? true;
  const effectiveCreatable = allowCreate ?? creatable ?? false;

  const inputId = useId();
  const listboxId = useId();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const selectedSet = useMemo(() => new Set(value), [value]);

  const optionByValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);

  const selectedLabels = useMemo(() => {
    return value
      .map((v) => {
        const o = optionByValue.get(v);
        return { value: v, label: o?.label ?? v };
      })
      .filter((x) => x.label.trim().length > 0);
  }, [optionByValue, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base =
      q && effectiveSearchable ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

    return base;
  }, [effectiveSearchable, options, query]);

  const normalizedQuery = query.trim();
  const normalizedQueryLower = normalizedQuery.toLowerCase();
  const hasExactOption = useMemo(() => {
    if (!normalizedQuery) return false;
    return options.some((o) => o.label.toLowerCase() === normalizedQueryLower);
  }, [normalizedQuery, normalizedQueryLower, options]);

  const canSelectMore = effectiveMax ? value.length < effectiveMax : true;

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

  const showCreate =
    effectiveCreatable &&
    Boolean(normalizedQuery) &&
    filtered.length === 0 &&
    canSelectMore &&
    !selectedSet.has(normalizedQuery) &&
    !hasExactOption;

  type MenuItem =
    | { type: 'create'; label: string; value: string }
    | { type: 'option'; option: MultiSelectOption };

  const menuItems = useMemo((): MenuItem[] => {
    const items: MenuItem[] = [];
    if (showCreate) items.push({ type: 'create', label: normalizedQuery, value: normalizedQuery });
    for (const o of filtered) items.push({ type: 'option', option: o });
    return items;
  }, [filtered, normalizedQuery, showCreate]);

  useEffect(() => {
    if (!open) {
      setActiveIndex(-1);
      return;
    }
    setActiveIndex((idx) => clamp(idx, -1, Math.max(-1, menuItems.length - 1)));
  }, [menuItems.length, open]);

  const activeDescendantId =
    open && activeIndex >= 0 && activeIndex < menuItems.length
      ? `${listboxId}-opt-${activeIndex}`
      : undefined;

  return (
    <div className={className}>
      <label htmlFor={inputId} className="text-xs font-medium text-muted">
        {label}
      </label>

      <div
        className={
          'mt-1.5 rounded-xl border border-border bg-card p-2.5 text-sm shadow-[var(--shadow-sm)] transition-[border-color,box-shadow] duration-200 focus-within:border-accent focus-within:ring-2 focus-within:ring-ring/40 ' +
          (disabled ? 'opacity-60' : '')
        }
        onMouseDown={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
          if (!disabled) setOpen(true);
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          {selectedLabels.map((o) => (
            <span
              key={o.value}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-subtle/80 py-1 pl-2.5 pr-1.5 text-sm text-foreground motion-safe:animate-[fadeIn_150ms_ease-out]"
            >
              <span className="max-w-48 truncate">{o.label}</span>
              <button
                type="button"
                aria-label={`Elimină ${o.label}`}
                className="rounded-md p-0.5 text-muted transition-all duration-150 hover:bg-error/10 hover:text-error focus-ring-standard"
                disabled={disabled}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  removeValue(o.value);
                }}
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}

          <input
            id={inputId}
            ref={inputRef}
            value={query}
            disabled={disabled}
            placeholder={selectedLabels.length === 0 ? placeholder : ''}
            className="min-w-24 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeDescendantId}
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
                setActiveIndex((idx) => clamp(idx + 1, 0, Math.max(0, menuItems.length - 1)));
                return;
              }

              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setOpen(true);
                setActiveIndex((idx) => clamp(idx - 1, 0, Math.max(0, menuItems.length - 1)));
                return;
              }

              if (e.key === 'Enter') {
                if (open && activeIndex >= 0 && activeIndex < menuItems.length) {
                  e.preventDefault();
                  const item = menuItems[activeIndex];
                  if (!item) return;
                  if (item.type === 'create') {
                    const created = onCreateOption?.(item.value);
                    toggleValue(created?.value ?? item.value);
                    setQuery('');
                    return;
                  }

                  toggleValue(item.option.value);
                  return;
                }

                if (showCreate) {
                  e.preventDefault();
                  const created = onCreateOption?.(normalizedQuery);
                  toggleValue(created?.value ?? normalizedQuery);
                  setQuery('');
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
        <div className="mt-2 flex items-center justify-end">
          <ChevronDown
            className={`size-4 text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </div>
      </div>

      {open ? (
        <div
          id={listboxId}
          role="listbox"
          aria-multiselectable="true"
          className="relative"
          aria-label={`${label} options`}
        >
          <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-border bg-card/80 shadow-lg shadow-black/5 backdrop-blur-xl motion-safe:animate-[fadeSlideUp_0.2s_ease-out]">
            <div className="max-h-64 overflow-y-auto">
              {menuItems.length > 0 ? (
                menuItems.map((item, idx) => {
                  const active = idx === activeIndex;

                  if (item.type === 'create') {
                    return (
                      <button
                        key="__create__"
                        id={`${listboxId}-opt-${idx}`}
                        type="button"
                        data-multi-select-option="true"
                        role="option"
                        aria-selected={active}
                        tabIndex={-1}
                        className={
                          'flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-foreground transition-colors duration-150 ' +
                          (active ? 'bg-primary/5' : 'hover:bg-subtle')
                        }
                        onMouseEnter={() => setActiveIndex(idx)}
                        onMouseDown={(ev) => ev.preventDefault()}
                        onClick={() => {
                          const created = onCreateOption?.(item.value);
                          toggleValue(created?.value ?? item.value);
                          setQuery('');
                        }}
                      >
                        Creează „{item.label}"
                      </button>
                    );
                  }

                  const o = item.option;
                  const checked = selectedSet.has(o.value);
                  const optionDisabled = Boolean(o.disabled) || (!checked && !canSelectMore);

                  return (
                    <button
                      key={o.value}
                      id={`${listboxId}-opt-${idx}`}
                      type="button"
                      data-multi-select-option="true"
                      role="option"
                      aria-selected={checked}
                      tabIndex={-1}
                      disabled={disabled === true || optionDisabled}
                      className={
                        'flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-foreground transition-colors duration-150 focus-ring-standard ' +
                        (active ? 'bg-primary/5' : 'hover:bg-subtle') +
                        (optionDisabled ? ' opacity-60' : '')
                      }
                      onMouseEnter={() => setActiveIndex(idx)}
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => toggleValue(o.value)}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={`flex size-4 shrink-0 items-center justify-center rounded border transition-colors ${
                            checked
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border'
                          }`}
                        >
                          {checked ? (
                            <svg className="size-3" viewBox="0 0 12 12" fill="none">
                              <path
                                d="M2.5 6L5 8.5L9.5 3.5"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          ) : null}
                        </span>
                        <span className="truncate">{o.label}</span>
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="px-3 py-2.5 text-sm text-muted">Niciun rezultat</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
