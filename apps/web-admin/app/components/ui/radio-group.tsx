import { useId } from 'react';
import type { ChangeEvent } from 'react';

export type RadioOption = Readonly<{
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}>;

export type RadioGroupProps = Readonly<{
  options: readonly RadioOption[];
  value?: string;
  onChange?: (value: string, e: ChangeEvent<HTMLInputElement>) => void;
  name?: string;
  label?: string;
  description?: string;
  error?: string;
  disabled?: boolean;
  orientation?: 'vertical' | 'horizontal';
  className?: string;
}>;

export function RadioGroup({
  options,
  value,
  onChange,
  name,
  label,
  description,
  error,
  disabled = false,
  orientation = 'vertical',
  className = '',
}: RadioGroupProps) {
  const uid = useId().replace(/:/g, '');
  const groupName = name ?? `radio-group-${uid}`;
  const descriptionId = description ? `${groupName}-desc` : undefined;
  const errorId = error ? `${groupName}-error` : undefined;

  return (
    <fieldset
      className={`border-none p-0 m-0 ${className}`}
      aria-describedby={descriptionId ?? errorId}
    >
      {label ? <legend className="text-sm font-medium text-foreground mb-2">{label}</legend> : null}
      {description ? (
        <p id={descriptionId} className="text-xs text-muted mb-2">
          {description}
        </p>
      ) : null}

      <div
        role="radiogroup"
        className={
          orientation === 'horizontal'
            ? 'flex flex-wrap items-center gap-4'
            : 'flex flex-col gap-2.5'
        }
      >
        {options.map((opt) => {
          const optId = `${groupName}-${opt.value}`;
          const isDisabled = disabled || opt.disabled;

          return (
            <div key={opt.value} className="flex items-start gap-2.5">
              <div className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                <input
                  type="radio"
                  id={optId}
                  name={groupName}
                  value={opt.value}
                  checked={value === opt.value}
                  disabled={isDisabled}
                  onChange={(e) => onChange?.(opt.value, e)}
                  className="peer absolute inset-0 h-4 w-4 cursor-pointer appearance-none rounded-full border border-border bg-card transition-[border-color,box-shadow,background-color] duration-fast hover:border-accent-border focus-ring-standard disabled:cursor-not-allowed disabled:opacity-50 checked:border-primary checked:bg-primary"
                />
                <span className="pointer-events-none hidden h-1.5 w-1.5 rounded-full bg-primary-foreground peer-checked:block motion-safe:animate-[scaleIn_0.15s_var(--ease-spring)_both]" />
              </div>

              <div className="flex flex-col gap-0.5">
                <label
                  htmlFor={optId}
                  className={`text-sm font-medium leading-none text-foreground ${isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                >
                  {opt.label}
                </label>
                {opt.description ? <p className="text-xs text-muted">{opt.description}</p> : null}
              </div>
            </div>
          );
        })}
      </div>

      {error ? (
        <p
          id={errorId}
          className="mt-1.5 text-xs text-error motion-safe:animate-[fadeSlideUp_0.15s_ease-out]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
