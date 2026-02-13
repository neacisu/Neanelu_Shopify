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
      aria-label="Loading dashboard"
      role="status"
    >
      {items.map((item) => (
        <div
          key={item}
          className={`animate-pulse rounded-lg border border-muted/20 bg-muted/10 ${blockHeight}`}
        />
      ))}
    </div>
  );
}
