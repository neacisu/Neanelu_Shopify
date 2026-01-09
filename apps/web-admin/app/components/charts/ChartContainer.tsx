import type { ReactNode } from 'react';

import { PolarisCard } from '../../../components/polaris/index.js';

export type ChartContainerProps = Readonly<{
  title: ReactNode;
  description?: ReactNode;
  height?: number;
  className?: string;
  actions?: ReactNode;

  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyState?: ReactNode;

  children: ReactNode;
}>;

export function ChartContainer(props: ChartContainerProps) {
  const {
    title,
    description,
    height = 220,
    className,
    actions,
    loading = false,
    error = null,
    empty = false,
    emptyState,
    children,
  } = props;

  return (
    <PolarisCard className={`p-4 ${className ?? ''}`.trim()}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-h4">{title}</div>
          {description ? <div className="mt-1 text-sm text-muted">{description}</div> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>

      <div className="mt-3" style={{ width: '100%', height }}>
        {loading ? <div className="text-sm text-muted">Loading…</div> : null}
        {error ? <div className="text-sm text-red-600">{error}</div> : null}
        {!loading && !error && empty
          ? (emptyState ?? <div className="text-sm text-muted">No data.</div>)
          : null}
        {!loading && !error && !empty ? children : null}
      </div>
    </PolarisCard>
  );
}
