import type { InputHTMLAttributes } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';

export function FormField({
  id,
  label,
  error,
  registration,
  ...inputProps
}: {
  id: string;
  label: string;
  error?: string | undefined;
  registration: UseFormRegisterReturn;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'name'>) {
  const describedBy = error ? `${id}-error` : undefined;

  return (
    <div>
      <label className="text-caption text-muted" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="mt-1 w-full rounded-md border border-muted/20 bg-background px-3 py-2 text-body shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        {...registration}
        {...inputProps}
      />
      {error ? (
        <div id={describedBy} role="alert" className="mt-1 text-caption text-error">
          {error}
        </div>
      ) : null}
    </div>
  );
}
