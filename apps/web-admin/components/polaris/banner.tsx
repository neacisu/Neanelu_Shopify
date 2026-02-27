import { useState, type ComponentPropsWithoutRef, type PropsWithChildren } from 'react';
import { X } from 'lucide-react';

const STATUS_CLASSES: Record<string, string> = {
  critical:
    'border-red-200 bg-red-50/80 text-red-800 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-200',
  warning:
    'border-amber-200 bg-amber-50/80 text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-200',
  success:
    'border-green-200 bg-green-50/80 text-green-800 dark:border-green-800/50 dark:bg-green-900/20 dark:text-green-200',
  info: 'border-sky-200 bg-sky-50/80 text-sky-800 dark:border-sky-800/50 dark:bg-sky-900/20 dark:text-sky-200',
};

export type PolarisBannerProps = PropsWithChildren<
  ComponentPropsWithoutRef<'div'> & {
    status?: 'critical' | 'warning' | 'success' | 'info';
    dismissible?: boolean;
    onDismiss?: () => void;
  }
>;

export function PolarisBanner({
  children,
  status = 'info',
  className = '',
  dismissible = false,
  onDismiss,
  ...props
}: PolarisBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const statusClass = STATUS_CLASSES[status] ?? STATUS_CLASSES['info'];

  if (dismissed) return null;

  return (
    <div
      role="alert"
      className={`
        rounded-xl border p-4
        ${statusClass}
        ${className}
      `}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        {dismissible ? (
          <button
            type="button"
            onClick={() => {
              setDismissed(true);
              onDismiss?.();
            }}
            className="shrink-0 rounded-lg p-1 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="Închide"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
