import type { InputHTMLAttributes, ReactNode } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';

import { InfoTooltip } from '../ui/info-tooltip';

export function FormField({
  id,
  label,
  error,
  registration,
  tooltip,
  ...inputProps
}: {
  id: string;
  label: string;
  error?: string | undefined;
  registration: UseFormRegisterReturn;
  tooltip?: ReactNode;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'name'>) {
  const describedBy = error ? `${id}-error` : undefined;

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <label
          className="text-xs font-medium uppercase tracking-wider text-muted dark:text-slate-400"
          htmlFor={id}
        >
          {label}
        </label>
        {tooltip ? <InfoTooltip title={label}>{tooltip}</InfoTooltip> : null}
      </div>
      <input
        id={id}
        className={`mt-1.5 w-full rounded-xl border bg-white/70 px-3 py-2.5 text-sm shadow-[var(--shadow-sm)] backdrop-blur-sm transition-[border-color,box-shadow] duration-200 focus:outline-none focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)] dark:bg-slate-900/70 dark:focus:shadow-[0_0_0_3px_rgba(96,165,250,0.2)] ${
          error
            ? 'border-red-300 focus:border-red-400 dark:border-red-700'
            : 'border-border focus:border-accent dark:border-slate-600'
        }`}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        {...registration}
        {...inputProps}
      />
      {error ? (
        <div
          id={describedBy}
          role="alert"
          className="mt-1.5 text-xs text-red-600 motion-safe:animate-[fadeSlideUp_0.15s_ease-out] dark:text-red-400"
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
