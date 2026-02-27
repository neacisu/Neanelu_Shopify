import type { ChangeEvent, ComponentPropsWithoutRef } from 'react';

export type PolarisTextFieldProps = Omit<
  ComponentPropsWithoutRef<'input'>,
  'value' | 'onChange'
> & {
  label?: string;
  value?: string;
  placeholder?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  error?: string;
};

export function PolarisTextField({
  label,
  value = '',
  placeholder,
  onChange,
  disabled,
  className = '',
  id,
  type = 'text',
  error,
  ...rest
}: PolarisTextFieldProps) {
  const inputId = id ?? `polaris-text-field-${Math.random().toString(36).slice(2, 9)}`;

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
      <input
        id={inputId}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={onChange}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : undefined}
        className={`
          h-10 w-full rounded-xl border bg-white/70 px-3 py-2
          text-sm text-foreground placeholder:text-muted
          shadow-[var(--shadow-sm)] backdrop-blur-sm
          transition-[border-color,box-shadow] duration-200
          focus:outline-none focus-visible:shadow-[0_0_0_3px_rgba(59,130,246,0.15)]
          disabled:cursor-not-allowed disabled:opacity-60
          dark:bg-slate-900/70 dark:text-foreground dark:placeholder:text-muted
          dark:focus-visible:shadow-[0_0_0_3px_rgba(96,165,250,0.2)]
          ${
            error
              ? 'border-red-300 focus-visible:border-red-400 dark:border-red-700'
              : 'border-border focus-visible:border-accent dark:border-slate-700'
          }
          ${className}
        `}
        aria-label={label}
        {...rest}
      />
      {error ? (
        <p
          id={`${inputId}-error`}
          className="text-xs text-red-600 dark:text-red-400 motion-safe:animate-[fadeSlideUp_0.15s_ease-out]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
