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

const EVENT_TYPES: Record<QueueStreamEventType, true> = {
  'queues.snapshot': true,
  'job.started': true,
  'job.completed': true,
  'job.failed': true,
  'worker.online': true,
  'worker.offline': true,
};

function isQueueStreamEventType(value: string): value is QueueStreamEventType {
  return (EVENT_TYPES as Record<string, true | undefined>)[value] === true;
}

function backoffMs(attempt: number): number {
  const base = 1000 * 2 ** Math.max(0, attempt - 1);
  return Math.min(30_000, base);
}

class StreamHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`stream_http_${status}`);
    this.name = 'StreamHttpError';
    this.status = status;
  }
}

async function connectSse(options: {
  signal: AbortSignal;
  onConnected: () => void;
  onEvent: (event: QueueStreamEvent) => void;
}): Promise<void> {
  const { signal, onConnected, onEvent } = options;

  const headers = await getSessionAuthHeaders();

  const response = await fetch('/api/queues/stream', {
    method: 'GET',
    credentials: 'include',
    headers,
    signal,
  });

  if (!response.ok) {
    throw new StreamHttpError(response.status);
  }

  onConnected();

  const body = response.body;
  if (!body) {
    throw new Error('stream_no_body');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');

  let buffer = '';
  let currentEvent: QueueStreamEventType | null = null;
  let dataLines: string[] = [];

  const flush = () => {
    if (!currentEvent) return;
    const dataRaw = dataLines.join('\n');
    dataLines = [];

    try {
      const parsed = JSON.parse(dataRaw) as unknown;
      if (parsed && typeof parsed === 'object') {
        onEvent({ type: currentEvent, data: parsed as Record<string, unknown> });
      } else {
        onEvent({ type: currentEvent, data: { value: parsed } });
      }
    } catch {
      onEvent({
        type: currentEvent,
        data: { raw: dataRaw },
      });
    }

    currentEvent = null;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const idx = buffer.indexOf('\n');
      if (idx === -1) break;

      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);

      if (!line.length) {
        flush();
        continue;
      }

      if (line.startsWith(':')) {
        continue;
      }

      if (line.startsWith('event:')) {
        const next = line.slice('event:'.length).trim();
        currentEvent = isQueueStreamEventType(next) ? next : null;
        continue;
      }

      if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart());
        continue;
      }
    }
  }
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

    const run = async () => {
      let attempt = 0;

      while (!cancelled && !abort.signal.aborted) {
        attempt += 1;
        setError(null);

        try {
          await connectSse({
            signal: abort.signal,
            onConnected: () => setConnected(true),
            onEvent: (evt) => {
              onEventRef.current?.(evt);
            },
          });

          // Normal stream end (treat as disconnect)
          setConnected(false);
        } catch (e) {
          setConnected(false);
          if (abort.signal.aborted) break;

          if (e instanceof StreamHttpError) {
            // Permanent-ish errors: stop reconnecting to avoid endless noise.
            if (e.status === 401 || e.status === 403) {
              setError('Unauthorized (401/403)');
              break;
            }
            if (e.status === 404) {
              setError('Stream endpoint not found (404)');
              break;
            }
          }

          const message = e instanceof Error ? e.message : 'stream_error';
          setError(message);
        }

        const wait = backoffMs(attempt);
        await new Promise<void>((resolve) => {
          const t = setTimeout(() => resolve(), wait);
          abort.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(t);
              resolve();
            },
            { once: true }
          );
        });
      }
    };

    void run();

    return () => {
      cancelled = true;
      abort.abort();
      setConnected(false);
    };
  }, [enabled]);

  return state;
}
