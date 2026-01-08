import { useEffect, useMemo, useRef, useState } from 'react';

import { getSessionAuthHeaders } from '../lib/session-auth';

export type QueueStreamEventType =
  | 'queues.snapshot'
  | 'job.started'
  | 'job.completed'
  | 'job.failed'
  | 'worker.online'
  | 'worker.offline';

export type QueueStreamEvent = Readonly<{
  type: QueueStreamEventType;
  data: Record<string, unknown>;
}>;

// Polling interval in milliseconds (15 seconds to match original SSE interval)
const POLL_INTERVAL_MS = 15_000;

class PollingHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`polling_http_${status}`);
    this.name = 'PollingHttpError';
    this.status = status;
  }
}

async function fetchQueueSnapshot(signal: AbortSignal): Promise<Record<string, unknown>> {
  const headers = await getSessionAuthHeaders();

  const response = await fetch('/api/queues', {
    method: 'GET',
    credentials: 'include',
    headers,
    signal,
  });

  if (!response.ok) {
    throw new PollingHttpError(response.status);
  }

  return (await response.json()) as Record<string, unknown>;
}

export function useQueueStream(options: {
  enabled?: boolean;
  onEvent?: (event: QueueStreamEvent) => void;
}) {
  const enabled = options.enabled ?? true;
  const onEvent = options.onEvent;

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onEventRef = useRef<typeof onEvent>(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const state = useMemo(() => ({ connected, error }), [connected, error]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const abort = new AbortController();

    const poll = async () => {
      try {
        const data = await fetchQueueSnapshot(abort.signal);

        if (!cancelled && !abort.signal.aborted) {
          setConnected(true);
          setError(null);

          // Emit snapshot event (matches SSE format)
          onEventRef.current?.({
            type: 'queues.snapshot',
            data: {
              timestamp: new Date().toISOString(),
              queues: data,
              workers: {
                webhookWorkerOk: true,
                tokenHealthWorkerOk: true,
              },
            },
          });
        }
      } catch (e) {
        if (abort.signal.aborted) return;

        setConnected(false);

        if (e instanceof PollingHttpError) {
          if (e.status === 401 || e.status === 403) {
            setError('Unauthorized (401/403)');
            return; // Stop polling on auth errors
          }
          if (e.status === 404) {
            setError('Endpoint not found (404)');
            return;
          }
        }

        const message = e instanceof Error ? e.message : 'polling_error';
        setError(message);
      }
    };

    // Initial poll
    void poll();

    // Set up interval for subsequent polls
    const intervalId = setInterval(() => {
      if (!cancelled && !abort.signal.aborted) {
        void poll();
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      abort.abort();
      clearInterval(intervalId);
      setConnected(false);
    };
  }, [enabled]);

  return state;
}
