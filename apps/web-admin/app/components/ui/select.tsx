import type { ChangeEvent, ComponentPropsWithoutRef, ReactNode } from 'react';
import { useId, useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

export type SelectOption = Readonly<{ label: string; value: string; disabled?: boolean }>;

export type SelectProps = Omit<ComponentPropsWithoutRef<'select'>, 'value' | 'onChange'> & {
  label?: string;
  value?: string;
  options: readonly SelectOption[];
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  description?: ReactNode;
  error?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
};

export function Select({
  label,
  value = '',
  options,
  onChange,
  disabled,
  className = '',
  id,
  description,
  error,
  searchable = false,
  searchPlaceholder = 'Caută...',
  ...rest
}: SelectProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const [search, setSearch] = useState('');

  const filteredOptions = useMemo(() => {
    if (!searchable || !search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search, searchable]);

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {label}
        </label>
      ) : null}
      {searchable ? (
        <div className="relative mb-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-sm text-foreground placeholder:text-muted focus-ring-standard"
            aria-label="Filtrează opțiuni"
          />
        </div>
      ) : null}
      <div className="relative">
        <select
          id={inputId}
          value={value}
          disabled={disabled}
          onChange={onChange}
          aria-invalid={error ? true : undefined}
          aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ') || undefined}
          className={`
 focus-ring-standard h-10 w-full appearance-none rounded-xl border bg-card px-3 py-2 pr-10 text-sm text-foreground
 shadow-[var(--shadow-sm)]
 transition-[border-color,box-shadow,background-color] duration-normal
 hover:border-accent-border
 disabled:cursor-not-allowed disabled:opacity-60
 ${error ? 'border-error/50' : 'border-border'}
        ${className}
        `}
          {...rest}
        >
          {filteredOptions.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted"
        />
      </div>
      {description ? (
        <p id={descriptionId} className="text-caption text-muted">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-caption text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
