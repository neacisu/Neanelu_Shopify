import type { ConsensusStats } from '../../types/consensus';

type ConsensusStatsCardsProps = Readonly<{
  stats: ConsensusStats;
}>;

export function ConsensusStatsCards({ stats }: ConsensusStatsCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <div className="rounded-lg border border-muted/20 bg-background p-4">
        <div className="text-xs text-muted">Products with consensus</div>
        <div className="text-h5">{stats.productsWithConsensus}</div>
      </div>
      <div className="rounded-lg border border-muted/20 bg-background p-4">
        <div className="text-xs text-muted">Pending consensus</div>
        <div className="text-h5">{stats.pendingConsensus}</div>
      </div>
      <div className="rounded-lg border border-muted/20 bg-background p-4">
        <div className="text-xs text-muted">Conflicts</div>
        <div className="text-h5">{stats.productsWithConflicts}</div>
      </div>
      <div className="rounded-lg border border-muted/20 bg-background p-4">
        <div className="text-xs text-muted">Resolved today</div>
        <div className="text-h5">{stats.resolvedToday}</div>
      </div>
    </div>
  );
}
