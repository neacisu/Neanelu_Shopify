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

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const connect = async () => {
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
      };

      source.onerror = () => {
        if (cancelled) return;
        setConnected(false);
        setError('Stream connection error');
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
      sourceRef.current?.close();
      sourceRef.current = null;
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
