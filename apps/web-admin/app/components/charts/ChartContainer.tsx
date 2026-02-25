import type { ReactNode } from 'react';

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
  const safeHeight = Math.max(height, 1);

  return (
    <article
      className={`overflow-hidden rounded-xl border border-slate-200/90 bg-white p-4 shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)] ${className ?? ''}`.trim()}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
          {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>

      <div
        className="mt-3"
        style={{ width: '100%', height: safeHeight, minHeight: 1, minWidth: 1 }}
      >
        {loading ? <div className="text-sm text-slate-500">Se încarcă…</div> : null}
        {error ? <div className="text-sm text-red-600">{error}</div> : null}
        {!loading && !error && empty
          ? (emptyState ?? <div className="text-sm text-slate-500">Fără date.</div>)
          : null}
        {!loading && !error && !empty ? children : null}
      </div>
    </article>
  );
}
