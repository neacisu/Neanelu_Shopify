import type { ComponentPropsWithoutRef, PropsWithChildren } from 'react';

const TONE_CLASSES: Record<
  'success' | 'warning' | 'critical' | 'info' | 'new' | 'neutral',
  string
> = {
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  new: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300',
};

export type PolarisBadgeProps = PropsWithChildren<
  ComponentPropsWithoutRef<'span'> & {
    tone?: 'success' | 'warning' | 'critical' | 'info' | 'new' | 'neutral';
  }
>;

export function PolarisBadge({
  children,
  tone = 'neutral',
  className = '',
  ...props
}: PolarisBadgeProps) {
  const toneClass = TONE_CLASSES[tone];

  return (
    <span
      className={`
        inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
        transition-transform duration-150
        hover:scale-105
        ${toneClass}
        ${className}
      `}
      {...props}
    >
      {children}
    </span>
  );
}
