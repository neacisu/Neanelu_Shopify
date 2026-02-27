import { Button } from '../ui/button';
import { InfoTooltip } from '../ui/info-tooltip';

type QueueStatus = Readonly<{
  queueName: string;
  paused: boolean;
  error?: string;
}>;

type ProviderStatus = Readonly<{
  provider: 'serper' | 'xai' | 'openai' | 'scraper';
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
    'pim-scraper-queue': 'PIM Scraper Queue',
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
    <div className="rounded-lg border border-muted/20 bg-background p-4 dark:border-slate-700/60 dark:bg-slate-900/80">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="inline-flex items-center gap-1.5 text-sm font-medium">
            Guvernanță cozi sensibile la cost
            <InfoTooltip title="Guvernanță cozi" side="bottom" maxWidth={360}>
              Panou pentru monitorizarea cozilor care consumă resurse plătite (ex. API-uri externe).
              Afișează statusul cozilor și bugetele per provider. Poți pune pe pauză toate cozile
              dacă bugetul e depășit sau pentru mentenanță.
            </InfoTooltip>
          </div>
          <div className="text-xs text-muted">Status live pentru cozi și bugete per provider.</div>
        </div>
        <div className="flex gap-2">
          <span className="inline-flex items-center gap-1.5">
            <Button size="sm" variant="secondary" onClick={onPauseAll} disabled={actionsDisabled}>
              Pauzează toate
            </Button>
            <InfoTooltip title="Pauzează toate" side="bottom" maxWidth={300}>
              Oprește temporar toate cozile din panou. Job-urile în execuție se termină; cele noi nu
              mai sunt luate în lucru până la „Reia toate".
            </InfoTooltip>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Button size="sm" variant="secondary" onClick={onResumeAll} disabled={actionsDisabled}>
              Reia toate
            </Button>
            <InfoTooltip title="Reia toate" side="bottom" maxWidth={280}>
              Repornește toate cozile după ce au fost puse pe pauză. Nu are efect dacă cozile nu
              sunt oprite.
            </InfoTooltip>
          </span>
        </div>
      </div>

      <div className="mb-4 grid gap-2 md:grid-cols-3">
        {providers.map((provider) => (
          <div
            key={provider.provider}
            className="rounded border border-muted/20 bg-background/50 p-2 dark:border-slate-700/60 dark:bg-slate-800/50"
          >
            <div className="text-xs text-muted uppercase dark:text-slate-400">
              {provider.provider}
            </div>
            <div
              className={`text-xs ${
                provider.exceeded
                  ? 'text-red-500 dark:text-red-400'
                  : provider.alertTriggered
                    ? 'text-amber-500 dark:text-amber-400'
                    : 'text-emerald-500 dark:text-emerald-400'
              }`}
            >
              {provider.exceeded ? 'Depășit' : provider.alertTriggered ? 'Atenție' : 'În regulă'} (
              {Math.round(provider.ratio * 100)}%)
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {queues.map((queue) => (
          <div
            key={queue.queueName}
            className="flex items-center justify-between rounded border border-muted/20 bg-background/50 p-2 dark:border-slate-700/60 dark:bg-slate-800/50"
          >
            <div>
              <div className="text-sm dark:text-slate-200">{toQueueLabel(queue.queueName)}</div>
              {queue.error ? (
                <div className="text-xs text-red-500 dark:text-red-400">{queue.error}</div>
              ) : null}
            </div>
            <div
              className={`text-xs ${queue.paused ? 'text-amber-500 dark:text-amber-400' : 'text-emerald-500 dark:text-emerald-400'}`}
              aria-label={`${queue.queueName} status`}
            >
              {queue.paused ? 'Pauzată' : 'Activă'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
