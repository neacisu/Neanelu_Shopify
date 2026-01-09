import type { ComponentType, ReactNode } from 'react';

import { PolarisCard } from '../../../components/polaris/index.js';
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
    <PolarisCard>
      <div className="rounded-md border border-muted/20 bg-background p-6 text-center shadow-sm">
        {Icon ? (
          <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-muted/10">
            <Icon className="size-5 text-muted" />
          </div>
        ) : null}
        <div className="text-h4">{title}</div>
        {description ? <div className="mt-2 text-body text-muted">{description}</div> : null}
        {actionLabel && onAction ? (
          <div className="mt-4 flex justify-center">
            <Button variant="secondary" onClick={onAction}>
              {actionLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </PolarisCard>
  );
}
