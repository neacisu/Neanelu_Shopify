import { useCallback, useMemo, useState } from 'react';
import { List, type RowComponentProps } from 'react-window';

import {
  PolarisBadge,
  PolarisButton,
  PolarisProgressBar,
  PolarisSelect,
  PolarisTextField,
} from '../../../components/polaris/index.js';

export type QueueJobListItem = Readonly<{
  id: string;
  name: string;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
  attemptsMade: number;
  attempts: number | null;
  progress: unknown;
  status: string | null;
  payloadPreview: string | null;
}>;

export type JobsTableAction = 'retry' | 'delete' | 'promote' | 'details';

export function JobsTable(props: {
  jobs: QueueJobListItem[];
  total: number;
  page: number;
  limit: number;
  status: string;
  search: string;
  loading?: boolean;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
  onAction: (action: JobsTableAction, jobIds: string[]) => void;
  onOpenDetails: (jobId: string) => void;
}) {
  const {
    jobs,
    total,
    page,
    limit,
    status,
    search,
    loading,
    onSearchChange,
    onStatusChange,
    onPageChange,
    onLimitChange,
    onAction,
    onOpenDetails,
  } = props;

  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const allOnPageSelected = useMemo(() => {
    if (!jobs.length) return false;
    return jobs.every((j) => selected.has(j.id));
  }, [jobs, selected]);

  const selectedCount = selected.size;

  const toggleAllOnPage = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (jobs.length === 0) return next;
      const shouldSelect = !jobs.every((j) => next.has(j.id));
      for (const j of jobs) {
        if (shouldSelect) next.add(j.id);
        else next.delete(j.id);
      }
      return next;
    });
  }, [jobs]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const statusOptions = useMemo(
    () => [
      { label: 'Waiting', value: 'waiting' },
      { label: 'Active', value: 'active' },
      { label: 'Failed', value: 'failed' },
      { label: 'Delayed', value: 'delayed' },
      { label: 'Completed', value: 'completed' },
      { label: 'All', value: 'all' },
    ],
    []
  );

  const limitOptions = useMemo(
    () => [
      { label: '25', value: '25' },
      { label: '50', value: '50' },
      { label: '100', value: '100' },
    ],
    []
  );

  const pageCount = Math.max(1, Math.ceil(total / limit));

  const statusTone = (
    s: string | null
  ): 'success' | 'warning' | 'critical' | 'info' | 'neutral' => {
    switch (s) {
      case 'completed':
        return 'success';
      case 'active':
        return 'info';
      case 'failed':
        return 'critical';
      case 'delayed':
      case 'waiting':
        return 'warning';
      default:
        return 'neutral';
    }
  };

  const progressValue = (p: unknown): number => {
    if (typeof p === 'number' && Number.isFinite(p)) return Math.max(0, Math.min(100, p));
    return 0;
  };

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      // ignore
    }
  };

  const renderRow = (job: QueueJobListItem) => {
    return (
      <tr key={job.id} className="border-b last:border-b-0">
        <td className="px-3 py-2">
          <input
            type="checkbox"
            checked={selected.has(job.id)}
            onChange={() => toggleOne(job.id)}
            aria-label={`Select job ${job.id}`}
          />
        </td>
        <td className="px-3 py-2">
          <button
            type="button"
            className="font-mono text-xs text-primary hover:underline"
            onClick={() => void copyId(job.id)}
            title="Copy job id"
          >
            {job.id}
          </button>
          <div>
            <button
              type="button"
              className="text-caption text-muted hover:underline"
              onClick={() => onOpenDetails(job.id)}
            >
              Details
            </button>
          </div>
        </td>
        <td className="px-3 py-2">
          <div className="max-w-lg truncate font-mono text-xs text-foreground/80">
            {job.payloadPreview ?? '—'}
          </div>
        </td>
        <td className="px-3 py-2">
          <PolarisProgressBar progress={progressValue(job.progress)} />
        </td>
        <td className="px-3 py-2">
          <PolarisBadge tone={statusTone(job.status)}>{job.status ?? 'unknown'}</PolarisBadge>
        </td>
        <td className="px-3 py-2">
          <PolarisSelect
            value=""
            options={[
              { label: 'Actions', value: '' },
              { label: 'Retry', value: 'retry' },
              { label: 'Promote', value: 'promote' },
              { label: 'Delete', value: 'delete' },
            ]}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value as JobsTableAction;
              if (!v) return;
              onAction(v, [job.id]);
              (e.target as HTMLSelectElement).value = '';
            }}
          />
        </td>
      </tr>
    );
  };

  const useVirtual = total > 1000;

  interface VirtualRowProps {
    jobs: QueueJobListItem[];
    selected: Set<string>;
    toggleOne: (id: string) => void;
    onOpenDetails: (jobId: string) => void;
    onAction: (action: JobsTableAction, jobIds: string[]) => void;
  }

  const VirtualRow = ({
    index,
    style,
    jobs,
    selected,
    toggleOne,
    onOpenDetails,
    onAction,
  }: RowComponentProps<VirtualRowProps>) => {
    const job = jobs[index];
    if (!job) return <div style={style} />;

    return (
      <div style={style} className="flex items-center gap-4 border-b px-3 text-sm last:border-b-0">
        <input
          type="checkbox"
          checked={selected.has(job.id)}
          onChange={() => toggleOne(job.id)}
          aria-label={`Select job ${job.id}`}
        />
        <div className="w-80">
          <div
            className="font-mono text-xs text-primary"
            role="button"
            tabIndex={0}
            onClick={() => void copyId(job.id)}
          >
            {job.id}
          </div>
          <button
            type="button"
            className="text-caption text-muted hover:underline"
            onClick={() => onOpenDetails(job.id)}
          >
            Details
          </button>
        </div>
        <div className="w-105 truncate font-mono text-xs text-foreground/80">
          {job.payloadPreview ?? '—'}
        </div>
        <div className="w-45">
          <PolarisProgressBar progress={progressValue(job.progress)} />
        </div>
        <div className="w-35">
          <PolarisBadge tone={statusTone(job.status)}>{job.status ?? 'unknown'}</PolarisBadge>
        </div>
        <div className="w-40">
          <PolarisSelect
            value=""
            options={[
              { label: 'Actions', value: '' },
              { label: 'Retry', value: 'retry' },
              { label: 'Promote', value: 'promote' },
              { label: 'Delete', value: 'delete' },
            ]}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value as JobsTableAction;
              if (!v) return;
              onAction(v, [job.id]);
              (e.target as HTMLSelectElement).value = '';
            }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64">
          <PolarisTextField
            value={search}
            label="Search"
            placeholder="Job id"
            onInput={(e) => onSearchChange((e.target as HTMLInputElement).value)}
          />
        </div>
        <div className="min-w-48">
          <PolarisSelect
            label="Status"
            value={status}
            options={statusOptions}
            onChange={(e) => onStatusChange((e.target as HTMLSelectElement).value)}
          />
        </div>
        <div className="min-w-32">
          <PolarisSelect
            label="Limit"
            value={String(limit)}
            options={limitOptions}
            onChange={(e) => onLimitChange(Number((e.target as HTMLSelectElement).value))}
          />
        </div>
        <div className="flex items-center gap-2">
          <PolarisButton
            variant="secondary"
            disabled={page <= 0 || Boolean(loading)}
            onClick={() => onPageChange(Math.max(0, page - 1))}
          >
            Prev
          </PolarisButton>
          <div className="text-caption text-muted">
            Page {page + 1} / {pageCount}
          </div>
          <PolarisButton
            variant="secondary"
            disabled={page + 1 >= pageCount || Boolean(loading)}
            onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
          >
            Next
          </PolarisButton>
        </div>
      </div>

      {selectedCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
          <div className="text-caption">
            Selected: <span className="font-mono">{selectedCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <PolarisButton
              variant="secondary"
              onClick={() => onAction('retry', Array.from(selected))}
            >
              Retry Selected
            </PolarisButton>
            <PolarisButton
              variant="critical"
              onClick={() => onAction('delete', Array.from(selected))}
            >
              Delete Selected
            </PolarisButton>
            <PolarisButton variant="plain" onClick={clearSelection}>
              Clear
            </PolarisButton>
          </div>
        </div>
      ) : null}

      <div className="overflow-auto rounded-md border">
        {!useVirtual ? (
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/20">
              <tr>
                <th className="px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleAllOnPage}
                    aria-label="Select all on page"
                  />
                </th>
                <th className="px-3 py-2 text-left">ID</th>
                <th className="px-3 py-2 text-left">Payload</th>
                <th className="px-3 py-2 text-left">Progress</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>{jobs.map(renderRow)}</tbody>
          </table>
        ) : (
          <div className="min-w-225">
            <div className="flex items-center gap-4 border-b bg-muted/20 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={allOnPageSelected}
                onChange={toggleAllOnPage}
                aria-label="Select all on page"
              />
              <div className="w-80">ID</div>
              <div className="w-105">Payload</div>
              <div className="w-45">Progress</div>
              <div className="w-35">Status</div>
              <div className="w-40">Actions</div>
            </div>
            <List<VirtualRowProps>
              defaultHeight={Math.min(480, Math.max(240, jobs.length * 48))}
              rowCount={jobs.length}
              rowHeight={48}
              rowComponent={VirtualRow}
              rowProps={{
                jobs,
                selected,
                toggleOne,
                onOpenDetails,
                onAction,
              }}
              style={{ height: Math.min(480, Math.max(240, jobs.length * 48)) }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
