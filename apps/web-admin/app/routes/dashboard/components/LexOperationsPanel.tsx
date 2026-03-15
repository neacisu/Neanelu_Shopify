import type { DashboardLexHealthComponentDto, DashboardLexSummaryDto } from '@app/types';

import { InfoTooltip } from '../../../components/ui/info-tooltip';
import { withAppBasePath } from '../../../lib/base-path';

type LexOperationsPanelProps = Readonly<{
  summary: DashboardLexSummaryDto;
  health: DashboardLexHealthComponentDto | null;
}>;

function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function getLexHealthTone(score: number | null): {
  badgeClassName: string;
  label: string;
} {
  if (score == null) {
    return {
      badgeClassName: 'border-warning/30 bg-warning/10 text-warning',
      label: 'Unknown',
    };
  }
  if (score >= 80) {
    return {
      badgeClassName: 'border-success/30 bg-success/10 text-success',
      label: 'Healthy',
    };
  }
  if (score >= 50) {
    return {
      badgeClassName: 'border-warning/30 bg-warning/10 text-warning',
      label: 'Degraded',
    };
  }
  return {
    badgeClassName: 'border-error/30 bg-error/10 text-error',
    label: 'Critical',
  };
}

export function LexOperationsPanel({ summary, health }: LexOperationsPanelProps) {
  const tone = getLexHealthTone(health?.score ?? null);

  const statItems = [
    { label: 'Runs active', value: summary.activeRuns },
    { label: 'Runs paused', value: summary.pausedRuns },
    { label: 'Failed shards', value: summary.failedShards },
    { label: 'Stale checkpoints', value: summary.staleCheckpoints },
    { label: 'AI backlog', value: summary.aiBatchBacklog },
    { label: 'Review backlog', value: summary.reviewBacklog },
    { label: 'Pending publications', value: summary.pendingPublications },
    { label: 'Failed publications', value: summary.failedPublications },
    { label: 'Publish conflicts', value: summary.publishConflicts },
    { label: 'DLQ entries', value: summary.dlqEntries },
    { label: 'Workers online', value: `${summary.workersOnline}/${summary.workersTotal}` },
    { label: 'Retention lag', value: formatDurationSeconds(summary.retentionLagSeconds) },
  ] as const;

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-sm)] backdrop-blur-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-primary">
            Operațiuni Lex
            <InfoTooltip title="Operațiuni Lex" side="bottom">
              CE ESTE: Rezumatul executiv al sănătății modulului lexical. DE CE CONTEAZĂ: Îți arată
              imediat dacă există runs blocate, worker-e offline, conflicte de publish sau backlog
              care necesită intervenție. SFAT: Pentru investigație detaliată mergi în PIM
              Translations sau în pagina generică de Cozi.
            </InfoTooltip>
          </div>
          <p className="mt-1 text-xs text-muted">
            Dashboard-ul global expune doar sănătatea operațională. Workspace-ul complet rămâne în
            PIM Translations.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tone.badgeClassName}`}
          >
            Lex {tone.label}
          </span>
          <span className="text-xs text-muted">Score {health?.score ?? 'N/A'}</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {statItems.map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2"
          >
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
              {item.label}
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
              {item.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          className="inline-flex items-center rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
          href={withAppBasePath('/pim/translations?tab=overview')}
        >
          Deschide PIM Translations
        </a>
        <a
          className="inline-flex items-center rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/30"
          href={withAppBasePath('/pim/translations?tab=publications')}
        >
          Vezi publications
        </a>
        <a
          className="inline-flex items-center rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/30"
          href={withAppBasePath('/queues?tab=overview')}
        >
          Vezi cozi
        </a>
      </div>
    </article>
  );
}
