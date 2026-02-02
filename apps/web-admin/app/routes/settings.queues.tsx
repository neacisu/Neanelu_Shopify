import { useEffect, useState } from 'react';

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
      <div className="rounded-md border border-muted/20 bg-muted/5 p-4 text-sm text-muted">
        Se încarcă setările pentru cozi...
      </div>
    );
  }

  if (queuesError) {
    return (
      <div className="rounded-md border border-error/30 bg-error/10 p-4 text-error shadow-sm">
        {queuesError}
      </div>
    );
  }

  if (!queuesData?.queues.length) {
    return (
      <div className="rounded-md border border-muted/20 bg-muted/5 p-4 text-sm text-muted">
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
          <div key={queue.name} className="rounded-md border border-muted/20 p-4 shadow-sm">
            <div className="text-sm font-semibold text-foreground">{queue.name}</div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-muted">Concurrency (1-50)</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={edit.concurrency}
                  disabled={disabled}
                  onChange={(event) =>
                    updateQueueEdit(queue.name, { concurrency: Number(event.target.value) })
                  }
                  className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted">Max attempts</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={edit.maxAttempts}
                  disabled={disabled}
                  onChange={(event) =>
                    updateQueueEdit(queue.name, { maxAttempts: Number(event.target.value) })
                  }
                  className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted">Backoff type</span>
                <select
                  value={edit.backoffType}
                  disabled={disabled}
                  onChange={(event) =>
                    updateQueueEdit(queue.name, {
                      backoffType: event.target.value as QueueConfig['backoffType'],
                    })
                  }
                  className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
                >
                  <option value="exponential">Exponential</option>
                  <option value="fixed">Fixed</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted">Backoff delay (ms)</span>
                <input
                  type="number"
                  min={0}
                  max={600000}
                  value={edit.backoffDelayMs}
                  disabled={disabled}
                  onChange={(event) =>
                    updateQueueEdit(queue.name, { backoffDelayMs: Number(event.target.value) })
                  }
                  className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted">DLQ retention (days)</span>
                <input
                  type="number"
                  min={7}
                  max={90}
                  value={edit.dlqRetentionDays}
                  disabled={disabled}
                  onChange={(event) =>
                    updateQueueEdit(queue.name, { dlqRetentionDays: Number(event.target.value) })
                  }
                  className="w-full rounded-md border border-muted/20 bg-background px-3 py-2"
                />
              </label>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                disabled={disabled || queueSaving === queue.name}
                onClick={() => void persistQueue(edit)}
                className="rounded-md border border-muted/20 px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {queueSaving === queue.name ? 'Se salvează...' : 'Apply'}
              </button>
              {queueSaveMessage[queue.name] ? (
                <span className="text-xs text-muted">{queueSaveMessage[queue.name]}</span>
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
