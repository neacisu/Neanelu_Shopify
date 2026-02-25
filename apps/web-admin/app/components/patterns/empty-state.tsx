import type { ComponentType, ReactNode } from 'react';

import { Button } from '../ui/button';

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200/90 bg-slate-50/50 p-8 text-center shadow-[var(--shadow-sm)]">
      {Icon ? (
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-white shadow-[var(--shadow-sm)] ring-1 ring-slate-200/80">
          <Icon className="size-6 text-slate-500" />
        </div>
      ) : null}
      <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
      {description ? <p className="mt-2 text-sm text-slate-500">{description}</p> : null}
      {actionLabel && onAction ? (
        <div className="mt-5 flex justify-center">
          <Button
            variant="secondary"
            onClick={onAction}
            className="transition-all duration-200 hover:shadow-[var(--shadow-sm)]"
          >
            {actionLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
