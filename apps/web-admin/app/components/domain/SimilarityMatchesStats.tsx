import type { MatchStats } from '../../hooks/use-similarity-matches';

interface SimilarityMatchesStatsProps {
  stats: MatchStats;
}

export function SimilarityMatchesStats({ stats }: SimilarityMatchesStatsProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="text-xs text-muted">Total</div>
          <div className="text-h5">{stats.total}</div>
        </div>
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="text-xs text-muted">Pending</div>
          <div className="text-h5">{stats.pending}</div>
        </div>
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="text-xs text-muted">Confirmed</div>
          <div className="text-h5">{stats.confirmed}</div>
        </div>
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="text-xs text-muted">Rejected</div>
          <div className="text-h5">{stats.rejected}</div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="text-xs text-muted">Auto-approved</div>
          <div className="text-h5">{stats.autoApproved}</div>
        </div>
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="text-xs text-muted">AI Audit pending</div>
          <div className="text-h5">{stats.aiAuditPending}</div>
        </div>
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="text-xs text-muted">AI Audit done</div>
          <div className="text-h5">{stats.aiAuditCompleted}</div>
        </div>
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="text-xs text-muted">HITL pending</div>
          <div className="text-h5">{stats.hitlPending}</div>
        </div>
      </div>

      <div className="rounded-lg border border-muted/20 bg-background p-4">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>Avg similarity score</span>
          <span>{stats.avgSimilarityScore.toFixed(2)}</span>
        </div>
        <div className="mt-2 h-2 w-full rounded-full bg-muted/10">
          <div
            className="h-2 rounded-full bg-primary/60"
            style={{ width: `${Math.min(Math.max(stats.avgSimilarityScore, 0), 1) * 100}%` }}
          />
        </div>
      </div>

      <div className="rounded-lg border border-muted/20 bg-background p-4">
        <div className="text-xs text-muted">Distribution</div>
        {stats.total === 0 ? (
          <div className="mt-2 text-xs text-muted">No data yet.</div>
        ) : (
          <>
            <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-muted/10">
              <div
                className="bg-success/70"
                style={{ width: `${(stats.autoApproved / stats.total) * 100}%` }}
              />
              <div
                className="bg-blue-500/70"
                style={{
                  width: `${((stats.aiAuditPending + stats.aiAuditCompleted) / stats.total) * 100}%`,
                }}
              />
              <div
                className="bg-warning/70"
                style={{ width: `${(stats.hitlPending / stats.total) * 100}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
              <span>Auto: {stats.autoApproved}</span>
              <span>AI Audit: {stats.aiAuditPending + stats.aiAuditCompleted}</span>
              <span>HITL: {stats.hitlPending}</span>
            </div>
          </>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="text-xs text-muted">Extraction complete</div>
          <div className="text-h5">{stats.extractionCompleted}</div>
        </div>
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="text-xs text-muted">Extraction pending</div>
          <div className="text-h5">{stats.extractionPending}</div>
        </div>
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="text-xs text-muted">Extraction in progress</div>
          <div className="text-h5">{stats.extractionInProgress}</div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="text-xs text-muted">Extraction success rate</div>
          <div className="text-h5">
            {stats.total > 0 ? Math.round((stats.extractionCompleted / stats.total) * 100) : 0}%
          </div>
        </div>
        <div className="rounded-lg border border-muted/20 bg-background p-4">
          <div className="text-xs text-muted">Avg extraction confidence</div>
          <div className="text-h5">
            {stats.avgExtractionConfidence > 0
              ? `${Math.round(stats.avgExtractionConfidence * 100)}%`
              : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}
