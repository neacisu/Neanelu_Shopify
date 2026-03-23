import { useCallback, useMemo, useState } from 'react';
import { List, type RowComponentProps } from 'react-window';

import { Badge } from '../ui/badge';
import { Checkbox } from '../ui/checkbox';
import { ProgressBar } from '../ui/progress-bar';
import { Select } from '../ui/select';
import { Button } from '../ui/button';
import { InfoTooltip } from '../ui/info-tooltip';
import { SearchInput } from '../ui/SearchInput';
import { useRecentSearches } from '../../hooks/use-recent-searches';

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

export type JobsTableAction = 'retry' | 'delete' | 'promote' | 'details' | 'dlq_replay';

interface JobsTableProps {
  jobs: QueueJobListItem[];
  total: number;
  page: number;
  limit: number;
  status: string;
  search: string;
  loading?: boolean;
  dlqReplayEnabled?: boolean;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
  onAction: (action: JobsTableAction, jobIds: string[]) => void;
  onOpenDetails: (jobId: string) => void;
}

interface VirtualRowProps {
  jobs: QueueJobListItem[];
  selected: Set<string>;
  toggleOne: (id: string) => void;
  onOpenDetails: (jobId: string) => void;
  onAction: (action: JobsTableAction, jobIds: string[]) => void;
  copyId: (id: string) => Promise<void>;
  getProgressValue: (progress: unknown) => number;
  getStatusTone: (status: string | null) => 'success' | 'warning' | 'critical' | 'info' | 'neutral';
  loading: boolean;
  dlqReplayEnabled: boolean;
}

function VirtualRow({
  index,
  style,
  jobs,
  selected,
  toggleOne,
  onOpenDetails,
  onAction,
  copyId,
  getProgressValue,
  getStatusTone,
  loading,
  dlqReplayEnabled: vDlq = false,
}: RowComponentProps<VirtualRowProps>) {
  const job = jobs[index];
  if (!job) return <div style={style} />;

  return (
    <div
      style={style}
      className="flex items-center gap-4 border-b border-border px-3 text-sm last:border-b-0"
    >
      <Checkbox
        checked={selected.has(job.id)}
        disabled={Boolean(loading)}
        onChange={() => toggleOne(job.id)}
        aria-label={`Select job ${job.id}`}
      />
      <div className="w-80">
        <button
          type="button"
          className="font-mono text-xs text-primary hover:underline"
          onClick={() => void copyId(job.id)}
        >
          {job.id}
        </button>
        <button
          type="button"
          className="text-caption text-muted hover:underline"
          onClick={() => onOpenDetails(job.id)}
        >
          Detalii
        </button>
      </div>
      <div className="w-105 truncate font-mono text-xs text-foreground/80">
        {job.payloadPreview ?? '—'}
      </div>
      <div className="w-45">
        <ProgressBar progress={getProgressValue(job.progress)} />
      </div>
      <div className="w-35">
        <Badge tone={getStatusTone(job.status)}>{job.status ?? 'unknown'}</Badge>
      </div>
      <div className="w-40">
        <Select
          value=""
          disabled={Boolean(loading)}
          options={[
            { label: 'Acțiuni', value: '' },
            { label: 'Relansează', value: 'retry' },
            ...(vDlq ? [{ label: 'Reia din DLQ', value: 'dlq_replay' }] : []),
            { label: 'Promovează', value: 'promote' },
            { label: 'Șterge', value: 'delete' },
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
}

export function JobsTable(props: Readonly<JobsTableProps>) {
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
    dlqReplayEnabled,
  } = props;

  const recent = useRecentSearches({ storageKey: 'neanelu:web-admin:queues:jobs:search:v1' });
  const recentSearches = recent.items;

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
      { label: 'În așteptare', value: 'waiting' },
      { label: 'Active', value: 'active' },
      { label: 'Eșuate', value: 'failed' },
      { label: 'Amânate', value: 'delayed' },
      { label: 'Finalizate', value: 'completed' },
      { label: 'Toate', value: 'all' },
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
      <tr
        key={job.id}
        className="group/row table-row-interactive border-b border-border/60 last:border-b-0"
      >
        <td className="px-3 py-2">
          <Checkbox
            checked={selected.has(job.id)}
            disabled={Boolean(loading)}
            onChange={() => toggleOne(job.id)}
            aria-label={`Select job ${job.id}`}
          />
        </td>
        <td className="px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void copyId(job.id)}
            title="Copy job id"
            className="font-mono text-xs text-primary hover:bg-primary/5"
          >
            {job.id}
          </Button>
          <div className="opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity">
            <Button variant="ghost" size="sm" onClick={() => onOpenDetails(job.id)}>
              Detalii
            </Button>
          </div>
        </td>
        <td className="px-3 py-2">
          <div className="max-w-lg truncate font-mono text-xs text-foreground/80">
            {job.payloadPreview ?? '—'}
          </div>
        </td>
        <td className="px-3 py-2">
          <ProgressBar progress={progressValue(job.progress)} />
        </td>
        <td className="px-3 py-2">
          <Badge tone={statusTone(job.status)}>{job.status ?? 'unknown'}</Badge>
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="sm"
              disabled={Boolean(loading)}
              onClick={() => onAction('retry', [job.id])}
            >
              Reîncearcă
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={Boolean(loading)}
              onClick={() => onAction('promote', [job.id])}
            >
              Promovează
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={Boolean(loading)}
              onClick={() => onAction('delete', [job.id])}
              className="text-error hover:bg-error/10"
            >
              Șterge
            </Button>
            {dlqReplayEnabled ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={Boolean(loading)}
                onClick={() => onAction('dlq_replay', [job.id])}
                className="text-warning hover:bg-warning/10"
              >
                DLQ
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => onOpenDetails(job.id)}>
              Detalii
            </Button>
          </div>
        </td>
      </tr>
    );
  };

  const useVirtual = total > 1000;
  const virtualRowProps: VirtualRowProps = {
    jobs,
    selected,
    toggleOne,
    onOpenDetails,
    onAction,
    copyId,
    getProgressValue: progressValue,
    getStatusTone: statusTone,
    loading: Boolean(loading),
    dlqReplayEnabled: Boolean(dlqReplayEnabled),
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64">
          <span className="inline-flex items-center gap-1.5">
            <SearchInput
              value={search}
              label="Caută"
              placeholder="ID job"
              debounceMs={250}
              onChange={(v) => {
                onSearchChange(v);
              }}
              recentSearches={recentSearches}
              onSearch={(v) => {
                recent.add(v);
                onSearchChange(v);
              }}
            />
            <InfoTooltip title="Căutare job" side="bottom">
              Caută job-uri după ID. Introdu ID-ul complet sau parțial și apasă Enter. Rezultatele
              se filtrează automat. Istoric căutări disponibil în dropdown.
            </InfoTooltip>
          </span>
        </div>
        <div className="min-w-48">
          <span className="inline-flex items-center gap-1.5">
            <Select
              label="Status"
              value={status}
              onChange={(e) => onStatusChange((e.target as HTMLSelectElement).value)}
              options={statusOptions}
            />
            <InfoTooltip title="Filtrare status" side="bottom">
              Filtrează job-urile după statusul lor: În așteptare, Active, Eșuate, Amânate,
              Finalizate sau Toate. Selectează un status pentru a vedea doar job-urile
              corespunzătoare.
            </InfoTooltip>
          </span>
        </div>
        <div className="min-w-32">
          <Select
            label="Limit"
            value={String(limit)}
            onChange={(e) => onLimitChange(Number((e.target as HTMLSelectElement).value))}
            options={limitOptions.map((opt) => ({ label: opt.label, value: String(opt.value) }))}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1">
            <Button
              variant="secondary"
              disabled={page <= 0 || Boolean(loading)}
              onClick={() => onPageChange(Math.max(0, page - 1))}
            >
              Prev
            </Button>
            <div className="text-caption text-muted tabular-nums">
              Pagina {page + 1} / {pageCount}
            </div>
            <Button
              variant="secondary"
              disabled={page + 1 >= pageCount || Boolean(loading)}
              onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
            >
              Next
            </Button>
            <InfoTooltip title="Paginare" side="bottom">
              Navighează între paginile de job-uri. Câte job-uri vezi pe pagină e controlat de
              câmpul „Limit". La schimbarea filtrelor, paginarea revine la pagina 1.
            </InfoTooltip>
          </span>
        </div>
      </div>

      {selectedCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-3">
          <div className="text-caption">
            Selectate: <span className="font-mono">{selectedCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5">
              <Button
                variant="neutral"
                disabled={Boolean(loading)}
                loading={Boolean(loading)}
                onClick={() => onAction('retry', Array.from(selected))}
              >
                Relansează selectate
              </Button>
              <InfoTooltip title="Relansează job-urile selectate" side="bottom">
                Pune din nou în coadă job-urile selectate care au eșuat; vor fi reprocesate de
                workeri. Poți selecta până la 100 de job-uri. Util când crezi că eșecul a fost
                temporar (de exemplu o eroare de rețea) și vrei să încerci din nou.
              </InfoTooltip>
            </span>
            {dlqReplayEnabled ? (
              <span className="inline-flex items-center gap-1.5">
                <Button
                  variant="secondary"
                  disabled={Boolean(loading)}
                  loading={Boolean(loading)}
                  onClick={() => onAction('dlq_replay', Array.from(selected))}
                >
                  Reia din DLQ
                </Button>
                <InfoTooltip title="Reia din DLQ" side="bottom">
                  Apare doar când coada selectată este o coadă DLQ (unde sunt mutate job-urile care
                  au eșuat după toate încercările). Mută job-urile selectate înapoi în coada
                  originală pentru a fi reprocesate; după mutare sunt șterse din DLQ. Folosește
                  acest buton când vrei să redai șansa unor job-uri eșuate.
                </InfoTooltip>
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              <Button
                variant="destructive"
                disabled={Boolean(loading)}
                loading={Boolean(loading)}
                onClick={() => onAction('delete', Array.from(selected))}
              >
                Șterge selectate
              </Button>
              <InfoTooltip title="Șterge job-urile selectate" side="bottom">
                Șterge definitiv din coadă job-urile selectate; nu mai pot fi relansate. Acțiunea
                este ireversibilă. Folosește-o pentru job-uri pe care nu vrei să le mai procesezi
                (de exemplu anulate sau invalide).
              </InfoTooltip>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Button variant="ghost" onClick={clearSelection}>
                Golește
              </Button>
              <InfoTooltip title="Golește selecția" side="bottom">
                Deselectează toate job-urile alese pe pagină; nu modifică nimic în coadă și nu
                execută nicio acțiune asupra job-urilor.
              </InfoTooltip>
            </span>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-border/80">
        {useVirtual ? (
          <div className="min-w-225">
            <div className="flex items-center gap-4 border-b bg-muted/20 px-3 py-2 text-sm">
              <Checkbox
                checked={allOnPageSelected}
                disabled={Boolean(loading)}
                onChange={toggleAllOnPage}
                aria-label="Select all on page"
              />
              <div className="w-80">ID</div>
              <div className="w-105">Payload</div>
              <div className="w-45">Progres</div>
              <div className="w-35">Status</div>
              <div className="w-40">Acțiuni</div>
            </div>
            <List<VirtualRowProps>
              defaultHeight={Math.min(480, Math.max(240, jobs.length * 48))}
              rowCount={jobs.length}
              rowHeight={48}
              rowComponent={VirtualRow}
              rowProps={virtualRowProps}
              style={{ height: Math.min(480, Math.max(240, jobs.length * 48)) }}
            />
          </div>
        ) : (
          <table className="min-w-175 w-full border-collapse text-sm">
            <thead className="bg-muted/20 sticky top-0 z-10">
              <tr className="">
                <th className="px-3 py-2 text-left">
                  <Checkbox
                    checked={allOnPageSelected}
                    disabled={Boolean(loading)}
                    onChange={toggleAllOnPage}
                    aria-label="Select all on page"
                  />
                </th>
                <th className="px-3 py-2 text-left">ID</th>
                <th className="px-3 py-2 text-left">Payload</th>
                <th className="px-3 py-2 text-left">Progres</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">
                  <span className="inline-flex items-center gap-1">
                    Acțiuni
                    <InfoTooltip title="Acțiuni pe job" side="bottom">
                      Retry: relansează job-ul eșuat. Promote: pentru job-uri „delayed", le mută mai
                      devreme în coadă ca să fie executate imediat. Delete: șterge definitiv job-ul.
                      Reia din DLQ: apare doar la cozi DLQ, mută job-ul înapoi în coada originală.
                      Details: deschide detaliile job-ului (payload, eroare, etc.).
                    </InfoTooltip>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>{jobs.map(renderRow)}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
