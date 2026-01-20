import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '../ui/button';
import { MultiSelect, type MultiSelectOption } from '../ui/MultiSelect';
import { VirtualizedList } from '../ui/VirtualizedList';
import { PolarisBadge } from '../../../components/polaris/index.js';
import type { LogEntry, LogLevel } from '../../types/log';

const levelColors: Record<LogLevel, string> = {
  debug: 'text-gray-400',
  info: 'text-blue-400',
  warn: 'text-amber-400',
  error: 'text-red-500',
};

const levelLabels: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const time = date.toLocaleTimeString('en-GB', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${time}.${ms}`;
}

export interface LogConsoleProps {
  logs: LogEntry[];
  maxLines?: number;
  autoScroll?: boolean;
  onClear?: () => void;
  paused?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  connected?: boolean;
  error?: string | null;
  levels?: LogLevel[];
  onLevelsChange?: (levels: LogLevel[]) => void;
  onTraceClick?: (traceId: string) => void;
  jaegerBaseUrl?: string;
  transport?: 'sse' | 'websocket' | 'polling';
  endpoint?: string;
  shopId?: string;
  maxEventsPerSecond?: number;
  bufferSize?: number;
  statusLabel?: string;
  statusTone?: 'success' | 'warning' | 'critical' | 'info' | 'new';
}

export function LogConsole({
  logs,
  maxLines = 500,
  autoScroll = true,
  onClear,
  paused,
  onPause,
  onResume,
  connected,
  error,
  levels,
  onLevelsChange,
  onTraceClick,
  jaegerBaseUrl,
  transport,
  statusLabel,
  statusTone,
}: LogConsoleProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [internalLevels, setInternalLevels] = useState<LogLevel[]>(
    levels ?? ['debug', 'info', 'warn', 'error']
  );

  useEffect(() => {
    if (levels) setInternalLevels(levels);
  }, [levels]);

  const levelOptions = useMemo<MultiSelectOption[]>(
    () => [
      { value: 'debug', label: 'Debug' },
      { value: 'info', label: 'Info' },
      { value: 'warn', label: 'Warn' },
      { value: 'error', label: 'Error' },
    ],
    []
  );

  const filteredLogs = useMemo(() => {
    const levelFiltered = internalLevels.length
      ? logs.filter((log) => internalLevels.includes(log.level))
      : logs;
    const source = showErrorsOnly
      ? levelFiltered.filter((log) => log.level === 'error')
      : levelFiltered;
    if (source.length <= maxLines) return source;
    return source.slice(-maxLines);
  }, [internalLevels, logs, maxLines, showErrorsOnly]);

  const handleTraceClick = useCallback(
    (traceId: string) => {
      if (onTraceClick) {
        onTraceClick(traceId);
        return;
      }
      if (jaegerBaseUrl) {
        window.open(`${jaegerBaseUrl.replace(/\/$/, '')}/trace/${traceId}`, '_blank');
      }
    },
    [jaegerBaseUrl, onTraceClick]
  );

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const scrollEl = root.querySelector<HTMLDivElement>('.log-console-scroll');
    if (!scrollEl) return;
    const onScroll = () => {
      const nearBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 24;
      setUserScrolledUp(!nearBottom);
    };
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollEl.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!autoScroll || userScrolledUp) return;
    const root = containerRef.current;
    const scrollEl = root?.querySelector<HTMLDivElement>('.log-console-scroll');
    if (!scrollEl) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }, [autoScroll, filteredLogs.length, userScrolledUp]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {statusLabel ? (
            <PolarisBadge tone={statusTone ?? 'warning'}>{statusLabel}</PolarisBadge>
          ) : connected !== undefined ? (
            <PolarisBadge tone={connected ? 'success' : 'warning'}>
              {connected ? 'Live' : 'Offline'}
            </PolarisBadge>
          ) : null}
          {error ? <span className="text-caption text-muted">{error}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-40">
            <MultiSelect
              label="Levels"
              value={internalLevels}
              options={levelOptions}
              onChange={(next) => {
                const cast = next.filter(
                  (v): v is LogLevel =>
                    v === 'debug' || v === 'info' || v === 'warn' || v === 'error'
                );
                setInternalLevels(cast);
                onLevelsChange?.(cast);
              }}
            />
          </div>
          <Button variant="secondary" size="sm" onClick={() => setShowErrorsOnly((prev) => !prev)}>
            {showErrorsOnly ? 'Show All' : 'Show Errors Only'}
          </Button>
          {paused !== undefined ? (
            <Button variant="neutral" size="sm" onClick={paused ? onResume : onPause}>
              {paused ? 'Resume' : 'Pause'}
            </Button>
          ) : null}
          {onClear ? (
            <Button variant="ghost" size="sm" onClick={onClear}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      <div
        ref={containerRef}
        className="rounded-md border bg-gray-950 px-2 py-2 text-xs text-gray-100"
      >
        <VirtualizedList
          items={filteredLogs}
          height={320}
          estimateSize={20}
          className="log-console-scroll font-mono"
          emptyState={<div className="p-3 text-gray-500">No logs yet.</div>}
          renderItem={(log) => (
            <div className="flex flex-wrap items-start gap-2 px-2 py-0.5">
              <span className="text-gray-500">[{formatTimestamp(log.timestamp)}]</span>
              <span className={levelColors[log.level]}>[{levelLabels[log.level]}]</span>
              {log.stepName ? <span className="text-gray-400">[{log.stepName}]</span> : null}
              <span className="whitespace-pre-wrap wrap-break-word">{log.message}</span>
              {log.traceId ? (
                <button
                  type="button"
                  className="text-gray-400 underline-offset-4 hover:underline"
                  onClick={() => handleTraceClick(log.traceId ?? '')}
                >
                  trace:{log.traceId}
                </button>
              ) : null}
            </div>
          )}
        />
      </div>

      {transport ? <div className="text-caption text-muted">Transport: {transport}</div> : null}
    </div>
  );
}
