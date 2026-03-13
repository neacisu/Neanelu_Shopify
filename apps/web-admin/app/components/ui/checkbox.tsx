import { useId } from 'react';
import type { ChangeEvent, ComponentPropsWithoutRef } from 'react';
import { Check, Minus } from 'lucide-react';

export type CheckboxProps = Omit<
  ComponentPropsWithoutRef<'input'>,
  'type' | 'checked' | 'onChange'
> & {
  checked?: boolean;
  indeterminate?: boolean;
  label?: string;
  description?: string;
  error?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
};

export function Checkbox({
  checked = false,
  indeterminate = false,
  label,
  description,
  error,
  disabled,
  id,
  onChange,
  className = '',
  ...rest
}: CheckboxProps) {
  const inputId = id ?? `checkbox-${useId().replace(/:/g, '')}`;
  const descriptionId = description ? `${inputId}-desc` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className={`flex items-start gap-2.5 ${className}`}>
      <div className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          id={inputId}
          checked={indeterminate ? false : checked}
          ref={(el) => {
            if (el) el.indeterminate = indeterminate;
          }}
          disabled={disabled}
          onChange={onChange}
          aria-checked={indeterminate ? 'mixed' : checked}
          aria-describedby={descriptionId ?? errorId}
          className="peer absolute inset-0 h-4 w-4 cursor-pointer appearance-none rounded-md border border-border bg-card transition-[border-color,box-shadow,background-color] duration-fast hover:border-accent-border focus-ring-standard disabled:cursor-not-allowed disabled:opacity-50 checked:border-primary checked:bg-primary indeterminate:border-primary indeterminate:bg-primary"
          {...rest}
        />
        <span className="pointer-events-none hidden text-primary-foreground peer-checked:flex peer-indeterminate:hidden">
          <Check className="h-2.5 w-2.5 stroke-[3]" />
        </span>
        <span className="pointer-events-none hidden text-primary-foreground peer-indeterminate:flex">
          <Minus className="h-2.5 w-2.5 stroke-[3]" />
        </span>
      </div>

      {(label ?? description ?? error) ? (
        <div className="flex flex-col gap-0.5">
          {label ? (
            <label
              htmlFor={inputId}
              className={`text-sm font-medium leading-none text-foreground ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            >
              {label}
            </label>
          ) : null}
          {description ? (
            <p id={descriptionId} className="text-xs text-muted">
              {description}
            </p>
          ) : null}
          {error ? (
            <p
              id={errorId}
              className="text-xs text-error motion-safe:animate-[fadeSlideUp_0.15s_ease-out]"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
