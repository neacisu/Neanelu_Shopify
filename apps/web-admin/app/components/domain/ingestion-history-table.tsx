import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { ChevronDown, ChevronUp, RotateCw, ScrollText } from 'lucide-react';

import { Button } from '../ui/button';
import { InfoTooltip } from '../ui/info-tooltip';
import { PolarisBadge, PolarisSelect } from '../../../components/polaris/index.js';

export type IngestionRunStatus =
  | 'pending'
  | 'running'
  | 'polling'
  | 'downloading'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type IngestionRunRow = Readonly<{
  id: string;
  status: IngestionRunStatus;
  createdAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  recordsProcessed?: number | null;
  errorCount?: number | null;
  checkpoint?: {
    committedRecords?: number | null;
    committedBytes?: number | null;
    committedLines?: number | null;
    lastCommitAt?: string | null;
  } | null;
}>;

export type IngestionHistoryTableProps = Readonly<{
  runs: readonly IngestionRunRow[];
  total: number;
  page: number;
  limit: number;
  statusFilter: string;
  sortKey: string;
  sortDir: 'asc' | 'desc';
  expandedRunId?: string | null;
  expandedContent?: (runId: string) => ReactNode;
  loading?: boolean;
  onStatusChange: (value: string) => void;
  onSortChange: (key: string) => void;
  onPageChange: (page: number) => void;
  onToggleErrors: (runId: string) => void;
  onRetry: (runId: string) => void;
  onViewLogs: (runId: string) => void;
}>;

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ro-RO', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(start?: string | null, end?: string | null): string {
  if (!start || !end) return '—';
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return '—';
  const totalSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function statusTone(
  status: IngestionRunStatus
): 'success' | 'critical' | 'warning' | 'info' | 'neutral' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'critical';
    case 'running':
      return 'warning';
    case 'pending':
      return 'info';
    default:
      return 'neutral';
  }
}

export function IngestionHistoryTable(props: IngestionHistoryTableProps) {
  const {
    runs,
    total,
    page,
    limit,
    statusFilter,
    sortKey,
    sortDir,
    expandedRunId,
    expandedContent,
    loading,
    onStatusChange,
    onSortChange,
    onPageChange,
    onToggleErrors,
    onRetry,
    onViewLogs,
  } = props;

  const pageCount = Math.max(1, Math.ceil(total / limit));

  const statusOptions = useMemo(
    () => [
      { label: 'Toate', value: 'all' },
      { label: 'În așteptare', value: 'pending' },
      { label: 'În curs', value: 'running' },
      { label: 'Finalizate', value: 'completed' },
      { label: 'Eșuate', value: 'failed' },
      { label: 'Anulate', value: 'cancelled' },
    ],
    []
  );

  const columns = [
    { key: 'startedAt', label: 'Start' },
    { key: 'duration', label: 'Durată' },
    { key: 'records', label: 'Înregistrări' },
    { key: 'status', label: 'Status' },
    { key: 'errors', label: 'Erori' },
  ];

  const sortIndicator = (key: string) => {
    if (sortKey !== key) return null;
    return sortDir === 'asc' ? (
      <ChevronUp className="size-3" />
    ) : (
      <ChevronDown className="size-3" />
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-48">
          <PolarisSelect
            label="Status"
            value={statusFilter}
            options={statusOptions}
            onChange={(e) => onStatusChange((e.target as HTMLSelectElement).value)}
          />
        </div>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-caption text-muted">
            {loading ? 'Se încarcă…' : `${total} rulări`}
          </span>
          <InfoTooltip title="Istoric ingestie" side="bottom" maxWidth={360}>
            Lista tuturor rulărilor de sincronizare. Poți filtra după status, sorta și deschide
            detaliile erorilor. Butonul „Logs" te duce la consola de loguri pentru rularea
            selectată.
          </InfoTooltip>
        </span>
      </div>

      <div className="overflow-auto rounded-md border dark:border-slate-700">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/20 dark:bg-slate-800/80 sticky top-0 z-10">
            <tr className="dark:border-slate-700">
              {columns.map((col) => (
                <th key={col.key} className="px-3 py-2 text-left">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-caption text-muted hover:text-foreground"
                    onClick={() => onSortChange(col.key)}
                  >
                    {col.label}
                    {sortIndicator(col.key)}
                  </button>
                </th>
              ))}
              <th className="px-3 py-2 text-left">Acțiuni</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-muted">
                  Nu există încă rulări de ingestie.
                </td>
              </tr>
            ) : (
              runs.flatMap((run, idx) => {
                const rows = [
                  <tr
                    key={run.id}
                    className="border-b last:border-b-0 transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/60 dark:border-slate-700/60 motion-safe:animate-[fadeSlideUp_0.3s_ease-out_both]"
                    style={{ animationDelay: `${idx * 50}ms` }}
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      {formatDate(run.startedAt ?? run.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-caption text-muted">
                      {formatDuration(run.startedAt ?? run.createdAt, run.completedAt)}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {typeof run.recordsProcessed === 'number' ? run.recordsProcessed : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <PolarisBadge tone={statusTone(run.status)}>{run.status}</PolarisBadge>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                        onClick={() => onToggleErrors(run.id)}
                      >
                        {typeof run.errorCount === 'number' ? run.errorCount : 0}
                        {expandedRunId === run.id ? (
                          <ChevronUp className="size-3" />
                        ) : (
                          <ChevronDown className="size-3" />
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => onViewLogs(run.id)}>
                          <ScrollText className="size-4" />
                          Loguri
                        </Button>
                        {run.status === 'failed' || run.status === 'polling' ? (
                          <Button variant="secondary" size="sm" onClick={() => onRetry(run.id)}>
                            <RotateCw className="size-4" />
                            Reîncearcă
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>,
                ];

                if (expandedRunId === run.id && expandedContent) {
                  rows.push(
                    <tr key={`${run.id}-expanded`} className="border-b last:border-b-0">
                      <td colSpan={columns.length + 1} className="bg-muted/5 px-3 py-3">
                        {expandedContent(run.id)}
                      </td>
                    </tr>
                  );
                }

                return rows;
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-caption text-muted">
          Page {page + 1} of {pageCount}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 0}
            onClick={() => onPageChange(Math.max(0, page - 1))}
          >
            Anterior
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={page + 1 >= pageCount}
            onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
          >
            Următorul
          </Button>
        </div>
      </div>
    </div>
  );
}
