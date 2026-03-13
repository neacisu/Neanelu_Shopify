export interface DashboardSkeletonProps {
  rows?: number;
  columns?: number;
  variant?: 'kpi' | 'chart' | 'table';
}

export function DashboardSkeleton({
  rows = 1,
  columns = 3,
  variant = 'kpi',
}: DashboardSkeletonProps) {
  const blockHeight = variant === 'chart' ? 'h-56' : variant === 'table' ? 'h-44' : 'h-24';
  const items = Array.from({ length: Math.max(1, rows * columns) }, (_, idx) => idx);

  return (
    <div
      className={`grid gap-4 ${columns >= 4 ? 'lg:grid-cols-4' : columns === 3 ? 'md:grid-cols-3' : columns === 2 ? 'md:grid-cols-2' : ''}`}
      aria-label="Se încarcă tabloul de bord"
      role="status"
    >
      {items.map((item) => (
        <div
          key={item}
          className={`overflow-hidden rounded-xl border border-border bg-subtle ${blockHeight}`}
        >
          <div className="h-full w-full animate-[shimmer-loading_1.5s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-foreground/10 to-transparent bg-[length:200%_100%]" />
        </div>
      ))}
    </div>
  );
}
