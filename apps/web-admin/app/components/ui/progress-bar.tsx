import type { ComponentPropsWithoutRef } from 'react';

export type ProgressBarProps = ComponentPropsWithoutRef<'div'> & {
  progress?: number;
};

export function ProgressBar({ progress = 0, className = '', ...rest }: ProgressBarProps) {
  const pct = Math.min(Math.max(Number(progress) || 0, 0), 100);

  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`
        h-2 w-full overflow-hidden rounded-full bg-slate-200/60
        dark:bg-slate-700/50
        ${className}
      `}
      {...rest}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-blue-400 to-blue-600 transition-all duration-500 ease-out dark:from-blue-500 dark:to-blue-400"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
