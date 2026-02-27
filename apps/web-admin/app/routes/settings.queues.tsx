import { useEffect, useState } from 'react';

import { InfoTooltip } from '../components/ui/info-tooltip';
import { WarningModal } from '../components/ui/warning-modal';
import { useApiClient } from '../hooks/use-api';

interface QueueConfig {
  name: string;
  concurrency: number;
  maxAttempts: number;
  backoffType: 'exponential' | 'fixed';
  backoffDelayMs: number;
  dlqRetentionDays: number;
}

export default function SettingsQueues() {
  const api = useApiClient();
  const [queuesLoading, setQueuesLoading] = useState(false);
  const [queuesError, setQueuesError] = useState<string | null>(null);
  const [queuesData, setQueuesData] = useState<{ queues: QueueConfig[]; isAdmin: boolean } | null>(
    null
  );
  const [queueEdits, setQueueEdits] = useState<Record<string, QueueConfig>>({});
  const [queueSaving, setQueueSaving] = useState<string | null>(null);
  const [queueSaveMessage, setQueueSaveMessage] = useState<Record<string, string>>({});
  const [warningQueue, setWarningQueue] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadQueues = async () => {
      setQueuesLoading(true);
      setQueuesError(null);
      try {
        const data = await api.getApi<{ queues: QueueConfig[]; isAdmin: boolean }>(
          '/settings/queues'
        );
        if (cancelled) return;
        setQueuesData(data);
        const edits: Record<string, QueueConfig> = {};
        for (const queue of data.queues) {
          edits[queue.name] = { ...queue };
        }
        setQueueEdits(edits);
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Nu am putut încărca cozi.';
          setQueuesError(message);
        }
      } finally {
        if (!cancelled) setQueuesLoading(false);
      }
    };

    void loadQueues();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const updateQueueEdit = (name: string, patch: Partial<QueueConfig>) => {
    setQueueEdits((prev) => {
      const current = prev[name] ?? queuesData?.queues.find((queue) => queue.name === name);
      if (!current) return prev;
      return {
        ...prev,
        [name]: { ...current, ...patch },
      };
    });
  };

  const persistQueue = async (queue: QueueConfig, skipWarning = false) => {
    if (!skipWarning && queue.concurrency > 20) {
      setWarningQueue(queue.name);
      return;
    }
    setQueueSaving(queue.name);
    setQueueSaveMessage((prev) => ({ ...prev, [queue.name]: '' }));
    try {
      await api.getApi('/settings/queues', {
        method: 'PUT',
        body: JSON.stringify({
          queueName: queue.name,
          concurrency: queue.concurrency,
          maxAttempts: queue.maxAttempts,
          backoffType: queue.backoffType,
          backoffDelayMs: queue.backoffDelayMs,
          dlqRetentionDays: queue.dlqRetentionDays,
        }),
      });
      setQueueSaveMessage((prev) => ({ ...prev, [queue.name]: 'Salvat.' }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Salvarea a eșuat.';
      setQueueSaveMessage((prev) => ({ ...prev, [queue.name]: message }));
    } finally {
      setQueueSaving(null);
    }
  };

  if (queuesLoading) {
    return (
      <div className="rounded-md border border-muted/20 bg-muted/5 p-4 text-sm text-muted dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
        Se încarcă setările pentru cozi...
      </div>
    );
  }

  if (queuesError) {
    return (
      <div className="rounded-md border border-error/30 bg-error/10 p-4 text-error shadow-sm dark:border-red-700/50 dark:bg-red-900/20">
        {queuesError}
      </div>
    );
  }

  if (!queuesData?.queues.length) {
    return (
      <div className="rounded-md border border-muted/20 bg-muted/5 p-4 text-sm text-muted dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
        Nu există cozi configurate.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {queuesData.queues.map((queue) => {
        const edit = queueEdits[queue.name] ?? queue;
        const disabled = queuesData.isAdmin === false;
        return (
          <div
            key={queue.name}
            className="rounded-md border border-muted/20 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/80"
          >
            <div className="text-sm font-semibold text-foreground dark:text-slate-100">
              {queue.name}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-muted dark:text-slate-400 inline-flex items-center gap-1">
                  Concurrență (1–50)
                  <InfoTooltip title="Concurrență" side="bottom" portalToBody>
                    Câți job-uri pot rula în paralel pentru această coadă. Valori mai mari
                    accelerează procesarea dar pot afecta stabilitatea. De exemplu, 10 workeri
                    procesează de 2× mai rapid decât 5. Sfat: 5–10 pentru cozi obișnuite, 10–20
                    pentru prioritare; peste 20 necesită confirmare.
                  </InfoTooltip>
                </span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={edit.concurrency}
                  disabled={disabled}
                  onChange={(event) =>
                    updateQueueEdit(queue.name, { concurrency: Number(event.target.value) })
                  }
                  className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted dark:text-slate-400 inline-flex items-center gap-1">
                  Încercări maxime
                  <InfoTooltip title="Încercări maxime" side="bottom" portalToBody>
                    Numărul maxim de încercări înainte ca job-ul să fie mutat în coada de erori
                    (DLQ). După acest număr, job-ul e marcat ca eșuat definitiv. De exemplu, cu 3
                    încercări și backoff exponențial, un job eșuat e reîncercat la 5s, 10s, 20s.
                    Sfat: 3–5 e recomandat pentru API-uri externe.
                  </InfoTooltip>
                </span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={edit.maxAttempts}
                  disabled={disabled}
                  onChange={(event) =>
                    updateQueueEdit(queue.name, { maxAttempts: Number(event.target.value) })
                  }
                  className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted dark:text-slate-400 inline-flex items-center gap-1">
                  Tip backoff
                  <InfoTooltip title="Tip backoff" side="bottom" portalToBody>
                    Strategia de pauză între reîncercări după eșec. „Exponential" crește progresiv
                    (1s→2s→4s) și reduce presiunea pe servicii suprasolicitate. „Fix" păstrează
                    pauza constantă. De exemplu, exponențial e mai bun pentru API Shopify cu rate
                    limiting. Sfat: alegeți exponential pentru API-uri externe.
                  </InfoTooltip>
                </span>
                <select
                  value={edit.backoffType}
                  disabled={disabled}
                  onChange={(event) =>
                    updateQueueEdit(queue.name, {
                      backoffType: event.target.value as QueueConfig['backoffType'],
                    })
                  }
                  className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
                >
                  <option value="exponential">Exponential</option>
                  <option value="fixed">Fix</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted dark:text-slate-400 inline-flex items-center gap-1">
                  Întârziere backoff (ms)
                  <InfoTooltip title="Întârziere backoff" side="bottom" portalToBody>
                    Durata pauzei inițiale în milisecunde între reîncercări. Pentru „exponential",
                    se dublează la fiecare eșec (5000→10000→20000). Pentru „fix", rămâne constantă.
                    De exemplu, 5000 ms (5 secunde) e un punct de plecare bun. Sfat: 5000–10000 ms
                    pentru API-uri cu rate limiting.
                  </InfoTooltip>
                </span>
                <input
                  type="number"
                  min={0}
                  max={600000}
                  value={edit.backoffDelayMs}
                  disabled={disabled}
                  onChange={(event) =>
                    updateQueueEdit(queue.name, { backoffDelayMs: Number(event.target.value) })
                  }
                  className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted dark:text-slate-400 inline-flex items-center gap-1">
                  Retenție DLQ (zile)
                  <InfoTooltip title="Retenție coadă erori" side="bottom" portalToBody>
                    Câte zile se păstrează job-urile eșuate în DLQ (Dead Letter Queue) înainte de
                    ștergere automată. Permite investigarea erorilor și relansarea manuală. De
                    exemplu, cu 30 zile retenție, poți analiza un eșec de acum 3 săptămâni. Sfat:
                    7–30 zile e suficient; 90 pentru audit.
                  </InfoTooltip>
                </span>
                <input
                  type="number"
                  min={7}
                  max={90}
                  value={edit.dlqRetentionDays}
                  disabled={disabled}
                  onChange={(event) =>
                    updateQueueEdit(queue.name, { dlqRetentionDays: Number(event.target.value) })
                  }
                  className="w-full rounded-md border border-muted/20 bg-background px-3 py-2 transition-shadow duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-400/50"
                />
              </label>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <button
                  type="button"
                  disabled={disabled || queueSaving === queue.name}
                  onClick={() => void persistQueue(edit)}
                  className="rounded-md border border-muted/20 px-4 py-2 text-sm font-medium shadow-sm transition-shadow duration-200 hover:bg-muted/10 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700/50 dark:focus:ring-blue-400/50"
                >
                  {queueSaving === queue.name ? 'Se salvează...' : 'Aplică'}
                </button>
                <InfoTooltip title="Aplică modificările" side="bottom" portalToBody>
                  Salvează modificările de configurare pentru această coadă. Noile valori se aplică
                  imediat job-urilor noi — cele aflate deja în procesare nu sunt afectate. De
                  exemplu, schimbarea concurenței de la 5 la 10 dublează imediat paralelismul. Sfat:
                  verifică impactul pe sistem după modificare.
                </InfoTooltip>
              </span>
              {queueSaveMessage[queue.name] ? (
                <span className="text-xs text-muted dark:text-slate-400">
                  {queueSaveMessage[queue.name]}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}

      <WarningModal
        open={Boolean(warningQueue)}
        title="Concurrency ridicat"
        description="Valori peste 20 pot impacta stabilitatea. Continui?"
        onConfirm={() => {
          const queueName = warningQueue;
          if (!queueName) return;
          setWarningQueue(null);
          const queue = queueEdits[queueName];
          if (queue) void persistQueue(queue, true);
        }}
        onCancel={() => setWarningQueue(null)}
      />
    </div>
  );
}
