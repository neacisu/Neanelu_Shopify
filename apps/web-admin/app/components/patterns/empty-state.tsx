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
    <div className="rounded-xl border border-border bg-card/60 p-8 text-center shadow-[var(--shadow-sm)] backdrop-blur-sm transition-all duration-200">
      {Icon ? (
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-subtle shadow-[var(--shadow-sm)] ring-1 ring-border/60">
          <Icon className="size-7 text-muted" />
        </div>
      ) : (
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-subtle">
          <svg
            aria-hidden="true"
            className="size-7 text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
            />
          </svg>
        </div>
      )}
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">{description}</p>
      ) : null}
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
