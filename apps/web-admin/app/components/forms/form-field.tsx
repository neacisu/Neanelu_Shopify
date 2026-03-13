import type { ReactNode } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';

import { InfoTooltip } from '../ui/info-tooltip';
import { TextField } from '../ui/text-field';

export function FormField({
  id,
  label,
  error,
  registration,
  tooltip,
  placeholder,
  type,
  disabled,
  required,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  registration: UseFormRegisterReturn;
  tooltip?: ReactNode;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const { onChange, onBlur, name } = registration;

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium uppercase tracking-wider text-muted" htmlFor={id}>
          {label}
        </label>
        {tooltip ? <InfoTooltip title={label}>{tooltip}</InfoTooltip> : null}
      </div>
      <TextField
        id={id}
        name={name}
        className="mt-1.5"
        {...(placeholder !== undefined ? { placeholder } : {})}
        {...(type !== undefined ? { type } : {})}
        {...(disabled !== undefined ? { disabled } : {})}
        {...(required !== undefined ? { required } : {})}
        {...(error !== undefined ? { error } : {})}
        onChange={(e) => void onChange(e)}
        onBlur={(e) => void onBlur(e)}
      />
    </div>
  );
}
