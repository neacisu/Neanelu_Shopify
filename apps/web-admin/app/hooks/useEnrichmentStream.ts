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
  const socketRef = useRef<WebSocket | null>(null);

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
        const parsed = JSON.parse(raw) as { event?: string; data?: unknown };
        const eventType = typeof parsed.event === 'string' ? parsed.event : 'message';
        const payload =
          parsed && typeof parsed.data === 'object' && parsed.data !== null
            ? (parsed.data as Record<string, unknown>)
            : (parsed as unknown as Record<string, unknown>);
        setEvents((prev) => [{ type: eventType, payload }, ...prev].slice(0, 200));
      } catch {
        // ignore malformed payloads
      }
    };

    const connect = () => {
      socketRef.current?.close();
      const url = new URL('/api/pim/events/ws', window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(url.toString());
      socketRef.current = socket;

      socket.addEventListener('message', handleMessage);
      socket.addEventListener('open', () => {
        if (closed) return;
        retryRef.current = 0;
        setConnected(true);
        setError(null);
      });
      socket.addEventListener('error', () => {
        if (closed) return;
        setConnected(false);
        setError('Stream connection error');
        socket.close();
        scheduleReconnect();
      });
      socket.addEventListener('close', () => {
        if (closed) return;
        setConnected(false);
        setError('Stream connection error');
        scheduleReconnect();
      });
    };

    connect();

    return () => {
      closed = true;
      socketRef.current?.close();
      socketRef.current = null;
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
