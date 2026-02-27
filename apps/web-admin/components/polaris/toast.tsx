import { toast } from 'sonner';
import type { ComponentPropsWithoutRef, PropsWithChildren } from 'react';

export type PolarisToastProps = PropsWithChildren<
  ComponentPropsWithoutRef<'div'> & {
    tone?: 'success' | 'warning' | 'critical' | 'info' | 'neutral';
  }
>;

/**
 * @deprecated Folosește `toast` din Sonner direct. Acest wrapper e menținut pentru compatibilitate.
 */
export function PolarisToast({
  children,
  tone = 'neutral',
  className = '',
  ...props
}: PolarisToastProps) {
  const TONE_CLASSES: Record<string, string> = {
    success:
      'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/30 dark:border-green-800/50 dark:text-green-200',
    warning:
      'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/30 dark:border-amber-800/50 dark:text-amber-200',
    critical:
      'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/30 dark:border-red-800/50 dark:text-red-200',
    info: 'bg-sky-50 border-sky-200 text-sky-800 dark:bg-sky-900/30 dark:border-sky-800/50 dark:text-sky-200',
    neutral:
      'bg-white border-slate-200 text-slate-800 dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-200',
  };

  const toneClass = TONE_CLASSES[tone] ?? TONE_CLASSES['neutral'];

  return (
    <div
      role="status"
      className={`
        rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm
        ${toneClass}
        ${className}
      `}
      {...props}
    >
      {children}
    </div>
  );
}

export { toast };
