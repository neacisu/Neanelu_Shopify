import { GaugeChart } from '../charts/GaugeChart';
import { Sparkline } from '../charts/Sparkline';

export type EnrichmentStats = Readonly<{
  pending: number;
  inProgress: number;
  completedToday: number;
  successRate: number;
  trendsData?: {
    pending?: number[];
    completed?: number[];
  };
}>;

export type EnrichmentStatsCardsProps = Readonly<{
  stats: EnrichmentStats;
}>;

export function EnrichmentStatsCards({ stats }: EnrichmentStatsCardsProps) {
  const pendingTrend = stats.trendsData?.pending ?? [];
  const completedTrend = stats.trendsData?.completed ?? [];
  const successPct = Math.min(Math.max(stats.successRate * 100, 0), 100);

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <div className="rounded-lg border border-muted/20 bg-background p-4">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>Pending</span>
          {pendingTrend.length ? <Sparkline data={pendingTrend} color="#f59e0b" /> : null}
        </div>
        <div className="text-h5">{stats.pending}</div>
      </div>

      <div className="rounded-lg border border-muted/20 bg-background p-4">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>In progress</span>
        </div>
        <div className="text-h5">{stats.inProgress}</div>
      </div>

      <div className="rounded-lg border border-muted/20 bg-background p-4">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>Completed today</span>
          {completedTrend.length ? <Sparkline data={completedTrend} color="#10b981" /> : null}
        </div>
        <div className="text-h5">{stats.completedToday}</div>
      </div>

      <div className="rounded-lg border border-muted/20 bg-background p-4">
        <div className="text-xs text-muted">Success rate</div>
        <div className="mt-2">
          <GaugeChart value={successPct} max={100} ariaLabel="Success rate" />
        </div>
      </div>
    </div>
  );
}
