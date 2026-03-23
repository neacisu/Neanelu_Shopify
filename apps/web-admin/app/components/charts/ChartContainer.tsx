import type { ReactNode } from 'react';
import { Button } from '../ui/button';

export type ChartContainerProps = Readonly<{
  title: ReactNode;
  description?: ReactNode;
  height?: number;
  className?: string;
  actions?: ReactNode;

  /** Când furnizat, afișează buton pentru afișare/ascundere legendă. */
  legendCollapsed?: boolean;
  onLegendToggle?: () => void;

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
    legendCollapsed,
    onLegendToggle,
    loading = false,
    error = null,
    empty = false,
    emptyState,
    children,
  } = props;
  const safeHeight = Math.max(height, 1);
  const legendButtonLabel = legendCollapsed ? 'Afișează legenda' : 'Ascunde legenda';

  return (
    <article
      className={`overflow-hidden rounded-xl border border-border bg-card/80 p-4 shadow-(--shadow-sm) backdrop-blur-sm transition-all duration-200 hover:shadow-(--shadow-md) motion-safe:animate-[chartFadeIn_300ms_ease-out_both] ${className ?? ''}`.trim()}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h3>
          {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
        </div>
        {onLegendToggle || actions ? (
          <div className="flex shrink-0 items-center gap-2">
            {onLegendToggle ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onLegendToggle}
                aria-pressed={legendCollapsed}
                aria-label={legendButtonLabel}
              >
                {legendButtonLabel}
              </Button>
            ) : null}
            {actions ?? null}
          </div>
        ) : null}
      </div>

      <div
        className="mt-3"
        style={{ width: '100%', height: safeHeight, minHeight: 1, minWidth: 1 }}
      >
        {loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
            <span className="text-xs text-muted">Se încarcă…</span>
          </div>
        ) : null}
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <svg
              className="h-6 w-6 text-error/70"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
            <span className="max-w-xs text-center text-xs text-error">{error}</span>
          </div>
        ) : null}
        {!loading && !error && empty
          ? (emptyState ?? (
              <div className="flex h-full flex-col items-center justify-center gap-2">
                <svg
                  className="h-8 w-8 text-muted"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
                  />
                </svg>
                <span className="text-xs text-muted">Fără date.</span>
              </div>
            ))
          : null}
        {!loading && !error && !empty ? children : null}
      </div>
    </article>
  );
}
