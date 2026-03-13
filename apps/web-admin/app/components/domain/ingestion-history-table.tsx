import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { ChevronDown, ChevronUp, RotateCw, ScrollText } from 'lucide-react';
import { useReducedMotion } from '../../hooks/use-reduced-motion';

import { Button } from '../ui/button';
import { InfoTooltip } from '../ui/info-tooltip';
import { Badge } from '../ui/badge';
import { Select } from '../ui/select';

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
  const reducedMotion = useReducedMotion();

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
          <Select
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

      <div className="overflow-x-auto rounded-md border border-border/80">
        <table className="min-w-[700px] w-full border-collapse text-sm">
          <thead className="bg-muted/20 sticky top-0 z-10">
            <tr className="">
              {columns.map((col) => (
                <th key={col.key} className="px-3 py-2 text-left">
                  <button
                    type="button"
                    className="interactive inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-caption text-muted hover:bg-subtle/50 hover:text-foreground"
                    onClick={() => onSortChange(col.key)}
                    aria-label={`Sortează după ${col.label}`}
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
                    className="table-row-interactive border-b border-border/60 last:border-b-0"
                    style={
                      reducedMotion
                        ? undefined
                        : { animation: `fadeSlideUp 0.3s ease-out ${idx * 50}ms both` }
                    }
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
                      <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="interactive inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-primary hover:bg-primary/5"
                        onClick={() => onToggleErrors(run.id)}
                        aria-label={`${expandedRunId === run.id ? 'Ascunde' : 'Afișează'} erorile pentru rularea ${run.id}`}
                        aria-expanded={expandedRunId === run.id}
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
          Pagina {page + 1} din {pageCount}
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
