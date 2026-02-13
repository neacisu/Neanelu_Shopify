import { Button } from '../ui/button';

type QueueStatus = Readonly<{
  queueName: string;
  paused: boolean;
  error?: string;
}>;

type ProviderStatus = Readonly<{
  provider: 'serper' | 'xai' | 'openai';
  exceeded: boolean;
  alertTriggered: boolean;
  ratio: number;
}>;

export type QueueGovernancePanelProps = Readonly<{
  queues: readonly QueueStatus[];
  providers: readonly ProviderStatus[];
  onPauseAll?: () => void;
  onResumeAll?: () => void;
  actionsDisabled?: boolean;
}>;

function toQueueLabel(queueName: string): string {
  const labels: Record<string, string> = {
    'ai-batch-queue': 'AI Batch Queue',
    'bulk-ingest-queue': 'Bulk Ingest Queue',
    'pim-enrichment-queue': 'PIM Enrichment Queue',
    'pim-similarity-search': 'PIM Similarity Search',
    'pim-ai-audit': 'PIM AI Audit',
    'pim-extraction': 'PIM Extraction',
  };
  return labels[queueName] ?? queueName;
}

export function QueueGovernancePanel({
  queues,
  providers,
  onPauseAll,
  onResumeAll,
  actionsDisabled = false,
}: QueueGovernancePanelProps) {
  return (
    <div className="rounded-lg border border-muted/20 bg-background p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">Guvernanta cozi cost-sensitive</div>
          <div className="text-xs text-muted">
            Status live pentru cozi + stare bugete per provider.
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onPauseAll} disabled={actionsDisabled}>
            Pauzeaza toate
          </Button>
          <Button size="sm" variant="secondary" onClick={onResumeAll} disabled={actionsDisabled}>
            Reia toate
          </Button>
        </div>
      </div>

      <div className="mb-4 grid gap-2 md:grid-cols-3">
        {providers.map((provider) => (
          <div
            key={provider.provider}
            className="rounded border border-muted/20 bg-background/50 p-2"
          >
            <div className="text-xs text-muted uppercase">{provider.provider}</div>
            <div
              className={`text-xs ${
                provider.exceeded
                  ? 'text-red-500'
                  : provider.alertTriggered
                    ? 'text-amber-500'
                    : 'text-emerald-500'
              }`}
            >
              {provider.exceeded ? 'Depasit' : provider.alertTriggered ? 'Atentie' : 'In regula'} (
              {Math.round(provider.ratio * 100)}%)
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {queues.map((queue) => (
          <div
            key={queue.queueName}
            className="flex items-center justify-between rounded border border-muted/20 bg-background/50 p-2"
          >
            <div>
              <div className="text-sm">{toQueueLabel(queue.queueName)}</div>
              {queue.error ? <div className="text-xs text-red-500">{queue.error}</div> : null}
            </div>
            <div
              className={`text-xs ${queue.paused ? 'text-amber-500' : 'text-emerald-500'}`}
              aria-label={`${queue.queueName} status`}
            >
              {queue.paused ? 'Pauzata' : 'Activa'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
