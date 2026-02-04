import { useEffect, useMemo, useRef, useState } from 'react';

export type EnrichmentStreamEvent = Readonly<{
  type: string;
  payload: Record<string, unknown>;
}>;

export type UseEnrichmentStreamOptions = Readonly<{
  enabled?: boolean;
}>;

export function useEnrichmentStream(options: UseEnrichmentStreamOptions = {}) {
  const { enabled = true } = options;
  const [events, setEvents] = useState<EnrichmentStreamEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retryRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let closed = false;

    const scheduleReconnect = () => {
      if (timeoutRef.current) return;
      retryRef.current += 1;
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(retryRef.current - 1, 6));
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        if (!closed) connect();
      }, delay);
    };

    const handleMessage = (evt: MessageEvent) => {
      if (closed) return;
      try {
        const raw = typeof evt.data === 'string' ? evt.data : String(evt.data);
        const payload = JSON.parse(raw) as Record<string, unknown>;
        setEvents((prev) => [{ type: evt.type || 'message', payload }, ...prev].slice(0, 200));
      } catch {
        // ignore malformed payloads
      }
    };

    const connect = () => {
      sourceRef.current?.close();
      const source = new EventSource('/api/pim/events/stream');
      sourceRef.current = source;

      source.addEventListener('quality.event', handleMessage);
      source.addEventListener('message', handleMessage);
      source.onopen = () => {
        if (closed) return;
        retryRef.current = 0;
        setConnected(true);
        setError(null);
      };
      source.onerror = () => {
        if (closed) return;
        setConnected(false);
        setError('Stream connection error');
        source.close();
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      closed = true;
      sourceRef.current?.close();
      sourceRef.current = null;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [enabled]);

  return useMemo(
    () => ({
      events,
      connected,
      error,
    }),
    [events, connected, error]
  );
}
