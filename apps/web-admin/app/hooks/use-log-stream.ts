import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { LogEntry, LogLevel } from '../types/log';
import { getSessionToken } from '../lib/session-auth';

const DEFAULT_BUFFER_SIZE = 1000;
const MIN_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30_000;
const MAX_RETRIES = 10;

function toLogLevel(value: unknown): LogLevel {
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') return value;
  return 'info';
}

function normalizeLogEntry(raw: Record<string, unknown>): LogEntry {
  const timestampValue =
    typeof raw['timestamp'] === 'string'
      ? raw['timestamp']
      : typeof raw['time'] === 'string'
        ? raw['time']
        : new Date().toISOString();

  const id =
    typeof raw['id'] === 'string'
      ? raw['id']
      : typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${timestampValue}-${Math.random().toString(36).slice(2)}`;

  const traceId = typeof raw['traceId'] === 'string' ? raw['traceId'] : undefined;
  const stepName = typeof raw['stepName'] === 'string' ? raw['stepName'] : undefined;
  const metadata =
    typeof raw['metadata'] === 'object' && raw['metadata'] !== null
      ? (raw['metadata'] as Record<string, unknown>)
      : undefined;

  return {
    id,
    timestamp: timestampValue,
    level: toLogLevel(raw['level']),
    message: typeof raw['message'] === 'string' ? raw['message'] : JSON.stringify(raw),
    ...(traceId ? { traceId } : {}),
    ...(stepName ? { stepName } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function normalizeLogPayload(payload: unknown): LogEntry[] {
  if (Array.isArray(payload)) {
    return payload
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map(normalizeLogEntry);
  }

  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj['logs'])) {
      return obj['logs']
        .filter(
          (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'
        )
        .map(normalizeLogEntry);
    }
    return [normalizeLogEntry(obj)];
  }

  return [];
}

export type UseLogStreamOptions = Readonly<{
  endpoint: string;
  enabled?: boolean;
  bufferSize?: number;
  shopId?: string;
  levels?: LogLevel[];
  maxEventsPerSecond?: number;
  onEvent?: (entries: LogEntry[]) => void;
}>;

export type LogStreamState = Readonly<{
  logs: LogEntry[];
  connected: boolean;
  error: string | null;
  paused: boolean;
  pause: () => void;
  resume: () => void;
  clear: () => void;
}>;

export function useLogStream(options: UseLogStreamOptions): LogStreamState {
  const { endpoint, onEvent } = options;
  const enabled = options.enabled ?? true;
  const bufferSize = options.bufferSize ?? DEFAULT_BUFFER_SIZE;
  const shopId = options.shopId;
  const levels = options.levels;
  const maxEventsPerSecond = options.maxEventsPerSecond ?? 50;

  const resolvedEndpoint = useMemo(() => {
    if (!endpoint) return '';
    try {
      const url = new URL(endpoint, window.location.origin);
      if (shopId) url.searchParams.set('shopId', shopId);
      if (levels?.length) url.searchParams.set('levels', levels.join(','));
      return url.toString();
    } catch {
      return endpoint;
    }
  }, [endpoint, levels, shopId]);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectDelayRef = useRef(MIN_RECONNECT_MS);
  const reconnectCountRef = useRef(0);
  const onEventRef = useRef(onEvent);
  const rateWindowRef = useRef<number>(0);
  const rateCountRef = useRef<number>(0);
  const connectRef = useRef<() => void>(() => undefined);
  const connectIdRef = useRef(0);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    clearReconnectTimer();
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setConnected(false);
  }, [clearReconnectTimer]);

  const scheduleReconnect = useCallback(() => {
    if (!enabled || paused) return;

    clearReconnectTimer();
    if (reconnectCountRef.current >= MAX_RETRIES) {
      setError('stream_unavailable');
      return;
    }
    reconnectCountRef.current += 1;
    const delay = reconnectDelayRef.current;
    reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, MAX_RECONNECT_MS);

    reconnectTimerRef.current = window.setTimeout(() => {
      if (!paused && enabled) {
        connectRef.current();
      }
    }, delay);
  }, [clearReconnectTimer, enabled, paused]);

  const connect = useCallback(() => {
    if (!enabled || paused || !resolvedEndpoint) return;

    disconnect();
    setError(null);
    const connectId = (connectIdRef.current += 1);
    void (async () => {
      const token = await getSessionToken();
      if (connectIdRef.current !== connectId) return;
      const url = new URL(resolvedEndpoint, window.location.origin);
      if (token) url.searchParams.set('token', token);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(url.toString());
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        reconnectDelayRef.current = MIN_RECONNECT_MS;
        reconnectCountRef.current = 0;
        setConnected(true);
        setError(null);
      });

      socket.addEventListener('message', (event) => {
        try {
          const parsed = JSON.parse(String(event.data)) as { event?: string; data?: unknown };
          const payload = parsed && 'data' in parsed ? parsed.data : parsed;
          let entries = normalizeLogPayload(payload);
          if (entries.length === 0) return;

          const nowSec = Math.floor(Date.now() / 1000);
          if (rateWindowRef.current !== nowSec) {
            rateWindowRef.current = nowSec;
            rateCountRef.current = 0;
          }

          const remaining = Math.max(0, maxEventsPerSecond - rateCountRef.current);
          if (remaining <= 0) return;
          if (entries.length > remaining) {
            entries = entries.slice(entries.length - remaining);
          }

          rateCountRef.current += entries.length;

          setLogs((prev) => {
            const next = [...prev, ...entries];
            return next.length > bufferSize ? next.slice(-bufferSize) : next;
          });

          onEventRef.current?.(entries);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'invalid_log_payload');
        }
      });

      let disconnecting = false;
      const handleClose = () => {
        if (disconnecting) return;
        disconnecting = true;
        setConnected(false);
        setError('stream_disconnected');
        scheduleReconnect();
      };

      const handleError = () => {
        if (disconnecting) return;
        disconnecting = true;
        setConnected(false);
        setError('stream_disconnected');
        socket.close();
        scheduleReconnect();
      };

      socket.addEventListener('error', handleError);
      socket.addEventListener('close', handleClose);
    })();
  }, [bufferSize, disconnect, enabled, paused, resolvedEndpoint, scheduleReconnect]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const pause = useCallback(() => {
    setPaused(true);
    disconnect();
  }, [disconnect]);

  const resume = useCallback(() => {
    setPaused(false);
    reconnectDelayRef.current = MIN_RECONNECT_MS;
    void connect();
  }, [connect]);

  const clear = useCallback(() => {
    setLogs([]);
  }, []);

  useEffect(() => {
    if (!enabled || paused) return;
    void connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect, enabled, paused]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return useMemo(
    () => ({ logs, connected, error, paused, pause, resume, clear }),
    [connected, error, logs, paused, pause, resume, clear]
  );
}
