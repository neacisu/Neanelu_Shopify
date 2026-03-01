import type { ChangeEvent, ComponentPropsWithoutRef } from 'react';

export type SelectOption = Readonly<{ label: string; value: string }>;

export type SelectProps = Omit<ComponentPropsWithoutRef<'select'>, 'value' | 'onChange'> & {
  label?: string;
  value?: string;
  options: readonly SelectOption[];
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
};

export function Select({
  label,
  value = '',
  options,
  onChange,
  disabled,
  className = '',
  id,
  ...rest
}: SelectProps) {
  const inputId = id ?? `select-${Math.random().toString(36).slice(2, 9)}`;

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-foreground dark:text-foreground"
        >
          {label}
        </label>
      ) : null}
      <select
        id={inputId}
        value={value}
        disabled={disabled}
        onChange={onChange}
        className={`
          h-10 appearance-none rounded-xl border border-border bg-white/70 px-3 py-2 text-sm text-foreground
          shadow-[var(--shadow-sm)] backdrop-blur-sm
          transition-[border-color,box-shadow] duration-200
          focus:outline-none focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_rgba(59,130,246,0.15)]
          disabled:cursor-not-allowed disabled:opacity-60
          dark:border-slate-700 dark:bg-slate-900/70 dark:text-foreground
          dark:focus-visible:shadow-[0_0_0_3px_rgba(96,165,250,0.2)]
          ${className}
        `}
        aria-label={label}
        {...rest}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
