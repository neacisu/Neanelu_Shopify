import { Brain, CheckCircle2, GitBranch, Search, FileText, Globe } from 'lucide-react';

export type PipelineStage = Readonly<{
  id: string;
  name: string;
  count: number;
  status: 'idle' | 'active' | 'bottleneck';
  avgDuration: number | null;
}>;

export type EnrichmentPipelineVizProps = Readonly<{
  stages: readonly PipelineStage[];
}>;

const stageIcons: Record<string, typeof Search> = {
  pending: GitBranch,
  search: Search,
  'ai-audit': Brain,
  scraper: Globe,
  extraction: FileText,
  complete: CheckCircle2,
};

function statusClass(status: PipelineStage['status']): string {
  if (status === 'bottleneck') return 'border-red-400 bg-red-50 text-red-700';
  if (status === 'active') return 'border-emerald-400 bg-emerald-50 text-emerald-700';
  return 'border-muted/30 bg-muted/10 text-muted';
}

export function EnrichmentPipelineViz({ stages }: EnrichmentPipelineVizProps) {
  if (!stages.length) {
    return (
      <div className="rounded-lg border border-muted/20 bg-background p-4 text-sm text-muted">
        No pipeline data available.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      {stages.map((stage) => {
        const Icon = stageIcons[stage.id] ?? GitBranch;
        return (
          <div
            key={stage.id}
            className={`flex min-w-[160px] flex-1 items-center gap-3 rounded-lg border p-3 ${statusClass(
              stage.status
            )}`}
          >
            <div className="rounded-md bg-background/70 p-2">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-wide">{stage.name}</div>
              <div className="text-h5">{stage.count}</div>
              <div className="text-[11px] opacity-80">
                Avg: {stage.avgDuration != null ? `${stage.avgDuration}m` : 'n/a'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
