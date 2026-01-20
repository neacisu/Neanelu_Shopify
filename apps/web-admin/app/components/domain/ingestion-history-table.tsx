import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { ChevronDown, ChevronUp, RotateCw, ScrollText } from 'lucide-react';

import { Button } from '../ui/button';
import { PolarisBadge, PolarisSelect } from '../../../components/polaris/index.js';

export type IngestionRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type IngestionRunRow = Readonly<{
  id: string;
  status: IngestionRunStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  recordsProcessed?: number | null;
  errorCount?: number | null;
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
  return date.toLocaleString('en-GB', {
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
      { label: 'All', value: 'all' },
      { label: 'Pending', value: 'pending' },
      { label: 'Running', value: 'running' },
      { label: 'Completed', value: 'completed' },
      { label: 'Failed', value: 'failed' },
      { label: 'Cancelled', value: 'cancelled' },
    ],
    []
  );

  const columns = [
    { key: 'startedAt', label: 'Start' },
    { key: 'duration', label: 'Duration' },
    { key: 'records', label: 'Records' },
    { key: 'status', label: 'Status' },
    { key: 'errors', label: 'Errors' },
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
        <div className="text-caption text-muted">{loading ? 'Loading…' : `${total} runs`}</div>
      </div>

      <div className="overflow-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/20">
            <tr>
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
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-muted">
                  No ingestion runs yet.
                </td>
              </tr>
            ) : (
              runs.flatMap((run) => {
                const rows = [
                  <tr key={run.id} className="border-b last:border-b-0">
                    <td className="px-3 py-2 font-mono text-xs">{formatDate(run.startedAt)}</td>
                    <td className="px-3 py-2 text-caption text-muted">
                      {formatDuration(run.startedAt, run.completedAt)}
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
                          Logs
                        </Button>
                        {run.status === 'failed' ? (
                          <Button variant="secondary" size="sm" onClick={() => onRetry(run.id)}>
                            <RotateCw className="size-4" />
                            Retry
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
            Previous
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={page + 1 >= pageCount}
            onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
