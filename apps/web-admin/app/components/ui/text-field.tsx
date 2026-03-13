import { useId } from 'react';
import type { ChangeEvent, ComponentPropsWithoutRef } from 'react';

export type TextFieldProps = Omit<ComponentPropsWithoutRef<'input'>, 'value' | 'onChange'> & {
  label?: string;
  value?: string;
  placeholder?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  error?: string;
};

export function TextField({
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
}: TextFieldProps) {
  const uid = useId().replace(/:/g, '');
  const inputId = id ?? `text-field-${uid}`;

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
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
 focus-ring-standard h-10 w-full rounded-xl border bg-card px-3 py-2
 text-sm text-foreground placeholder:text-muted
 shadow-[var(--shadow-sm)]
 transition-[border-color,box-shadow,background-color] duration-normal
 hover:border-accent-border
 disabled:cursor-not-allowed disabled:opacity-60
 ${error ? 'border-error/50' : 'border-border'}
        ${className}
        `}
        {...rest}
      />
      {error ? (
        <p
          id={`${inputId}-error`}
          className="text-xs text-error motion-safe:animate-[fadeSlideUp_0.15s_ease-out]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
