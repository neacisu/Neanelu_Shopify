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
  if (status === 'bottleneck') return 'border-error/60 bg-error/5 text-error';
  if (status === 'active') return 'border-success/60 bg-success/5 text-success';
  return 'border-muted/30 bg-muted/10 text-muted';
}

export function EnrichmentPipelineViz({ stages }: EnrichmentPipelineVizProps) {
  if (!stages.length) {
    return (
      <div className="rounded-lg border border-muted/20 bg-card/80 backdrop-blur-sm p-4 text-sm text-muted">
        Nu există date pentru pipeline.
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
            <div className="rounded-md bg-card/70 p-2">
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
