import { useEffect, useMemo, useRef, useState } from 'react';

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

    let closed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let delay = 1000;

    const clearReconnect = () => {
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (reconnectTimer) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        if (!closed) connect();
      }, delay);
      delay = Math.min(delay * 2, 30_000);
    };

    const connect = () => {
      socket?.close();
      const url = new URL('/api/queues/ws', window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(url.toString());

      socket.addEventListener('open', () => {
        if (closed) return;
        delay = 1000;
        setConnected(true);
        setError(null);
      });

      socket.addEventListener('message', (event) => {
        if (closed) return;
        try {
          const parsed = JSON.parse(String(event.data)) as { event?: string; data?: unknown };
          const type = typeof parsed.event === 'string' ? parsed.event : 'message';
          const data =
            parsed && typeof parsed.data === 'object' && parsed.data !== null
              ? (parsed.data as Record<string, unknown>)
              : {};
          onEventRef.current?.({ type: type as QueueStreamEventType, data });
        } catch (err) {
          setError(err instanceof Error ? err.message : 'invalid_queue_payload');
        }
      });

      const handleDisconnect = () => {
        if (closed) return;
        setConnected(false);
        setError('stream_disconnected');
        scheduleReconnect();
      };

      socket.addEventListener('error', handleDisconnect);
      socket.addEventListener('close', handleDisconnect);
    };

    connect();

    return () => {
      closed = true;
      clearReconnect();
      socket?.close();
      setConnected(false);
    };
  }, [enabled]);

  return state;
}
