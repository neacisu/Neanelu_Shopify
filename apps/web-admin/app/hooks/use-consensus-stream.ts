import { useEffect, useMemo, useRef, useState } from 'react';

import { getSessionToken } from '../lib/session-auth';

export type ConsensusStreamEvent = Readonly<{
  type: string;
  payload: Record<string, unknown>;
}>;

export type UseConsensusStreamOptions = Readonly<{
  enabled?: boolean;
}>;

export function useConsensusStream(options: UseConsensusStreamOptions = {}) {
  const { enabled = true } = options;
  const [events, setEvents] = useState<ConsensusStreamEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const cleanup = () => {
      if (reconnectTimeoutRef.current != null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      sourceRef.current?.close();
      sourceRef.current = null;
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      attemptRef.current += 1;
      const attempt = Math.min(attemptRef.current, 6); // cap growth
      const baseMs = 1000 * 2 ** (attempt - 1); // 1s,2s,4s,8s,16s,32s
      const delayMs = Math.min(30_000, baseMs) + Math.floor(Math.random() * 250);
      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectTimeoutRef.current = null;
        void connect();
      }, delayMs);
    };

    const connect = async () => {
      cleanup();
      const token = await getSessionToken();
      if (cancelled) return;
      const url = new URL('/api/pim/consensus/stream', window.location.origin);
      if (token) url.searchParams.set('token', token);
      const source = new EventSource(url.toString());
      sourceRef.current = source;

      source.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        setError(null);
        attemptRef.current = 0; // reset backoff on successful open
      };

      source.onerror = () => {
        if (cancelled) return;
        setConnected(false);
        setError('Stream connection error');
        // EventSource retries internally, but we want fresh tokens + controlled backoff.
        cleanup();
        scheduleReconnect();
      };

      const handle = (evt: MessageEvent) => {
        if (cancelled) return;
        try {
          const payload =
            typeof evt.data === 'string' ? (JSON.parse(evt.data) as Record<string, unknown>) : {};
          setEvents((prev) => [{ type: evt.type, payload }, ...prev].slice(0, 200));
        } catch {
          // ignore malformed payloads
        }
      };

      source.addEventListener('consensus.init', handle);
      source.addEventListener('consensus.event', handle);
      source.addEventListener('consensus.heartbeat', handle);
    };

    void connect();

    return () => {
      cancelled = true;
      cleanup();
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
