import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  UNSAFE_DataWithResponseInit,
} from 'react-router-dom';
import {
  data,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
  useRevalidator,
} from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { Tabs } from '../components/ui/tabs';
import { ErrorDetailsRow, IngestionHistoryTable, RetryDialog } from '../components/domain/index.js';
import { PolarisCard } from '../../components/polaris/index.js';
import { apiAction, type ActionData, createActionApiClient } from '../utils/actions';
import { apiLoader, createLoaderApiClient, type LoaderData } from '../utils/loaders';

import type { IngestionRunRow } from '../components/domain/ingestion-history-table';
import type { IngestionErrorRow } from '../components/domain/error-details-row';

function parseIntParam(value: string | null, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function formatCheckpointLabel(checkpoint: IngestionRunRow['checkpoint']): string | null {
  if (!checkpoint) return null;
  const parts: string[] = [];
  if (typeof checkpoint.committedRecords === 'number') {
    parts.push(`Committed ${checkpoint.committedRecords} records`);
  } else if (typeof checkpoint.committedLines === 'number') {
    parts.push(`Committed ${checkpoint.committedLines} lines`);
  }

  if (checkpoint.lastCommitAt) {
    const date = new Date(checkpoint.lastCommitAt);
    parts.push(
      Number.isNaN(date.getTime())
        ? `Last commit ${checkpoint.lastCommitAt}`
        : `Last commit ${date.toLocaleString('en-GB')}`
    );
  }

  return parts.length ? parts.join(' · ') : null;
}

type HistoryLoaderData = Readonly<{
  runs: IngestionRunRow[];
  total: number;
  page: number;
  limit: number;
  status: string;
  sort: string;
  dir: 'asc' | 'desc';
  errorsForRunId: string | null;
  errors: IngestionErrorRow[];
}>;

type RetryActionIntent = 'bulk.retry';

type RetryActionResult =
  | { ok: true; intent: RetryActionIntent; toast?: { type: 'success' | 'error'; message: string } }
  | { ok: false; error: { code: string; message: string } };

export const loader = apiLoader(async (args: LoaderFunctionArgs): Promise<HistoryLoaderData> => {
  const api = createLoaderApiClient();
  const url = new URL(args.request.url);

  const status = url.searchParams.get('status') ?? 'all';
  const page = parseIntParam(url.searchParams.get('page'), 0, 0, 10_000);
  const limit = parseIntParam(url.searchParams.get('limit'), 20, 1, 100);
  const sort = url.searchParams.get('sort') ?? 'startedAt';
  const dir = (url.searchParams.get('dir') ?? 'desc') as 'asc' | 'desc';
  const errorsForRunId = url.searchParams.get('runId');

  const q = new URLSearchParams();
  q.set('page', String(page));
  q.set('limit', String(limit));
  q.set('sort', sort);
  q.set('dir', dir);
  if (status !== 'all') q.set('status', status);

  const listRes = await api.getApi<{ runs: IngestionRunRow[]; total: number }>(
    `/bulk?${q.toString()}`
  );

  let errors: IngestionErrorRow[] = [];
  if (errorsForRunId) {
    const errorsRes = await api.getApi<{ errors: IngestionErrorRow[] }>(
      `/bulk/${encodeURIComponent(errorsForRunId)}/errors?limit=50`
    );
    errors = errorsRes.errors;
  }

  return {
    runs: listRes.runs,
    total: listRes.total,
    page,
    limit,
    status,
    sort,
    dir,
    errorsForRunId,
    errors,
  };
});

type ActionReturn = Response | RetryActionResult | UNSAFE_DataWithResponseInit<RetryActionResult>;

export const action: (args: ActionFunctionArgs) => Promise<ActionReturn> = apiAction<ActionReturn>(
  async (args: ActionFunctionArgs) => {
    const api = createActionApiClient();
    const formData = await args.request.formData();
    const intent = formData.get('intent');

    if (intent !== 'bulk.retry') {
      return data(
        { ok: false, error: { code: 'missing_intent', message: 'Missing intent' } },
        { status: 400 }
      );
    }

    const runId = formData.get('runId');
    if (!runId || typeof runId !== 'string') {
      return data(
        { ok: false, error: { code: 'missing_runId', message: 'Missing runId' } },
        { status: 400 }
      );
    }

    const mode = formData.get('mode');
    await api.postApi(`/bulk/${encodeURIComponent(runId)}/retry`, {
      ...(mode === 'restart' || mode === 'resume' ? { mode } : {}),
    });

    return data({
      ok: true,
      intent: 'bulk.retry',
      toast: { type: 'success', message: 'Reincercare programata' },
    } satisfies RetryActionResult);
  }
);

type RouteLoaderData = LoaderData<typeof loader>;
type RouteActionData = ActionData<typeof action>;

export default function IngestionHistoryPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const { runs, total, page, limit, status, sort, dir, errorsForRunId, errors } =
    useLoaderData<RouteLoaderData>();

  const actionFetcher = useFetcher<RouteActionData>();
  const [retryRunId, setRetryRunId] = useState<string | null>(null);
  const [expandedErrors, setExpandedErrors] = useState<Record<string, boolean>>({});
  const retryRun = useMemo(
    () => (retryRunId ? (runs.find((run) => run.id === retryRunId) ?? null) : null),
    [retryRunId, runs]
  );
  const retryCheckpointLabel = useMemo(
    () => formatCheckpointLabel(retryRun?.checkpoint ?? null),
    [retryRun]
  );

  useEffect(() => {
    const result = actionFetcher.data;
    if (!result) return;
    if (result.ok) {
      if ('toast' in result && result.toast?.type === 'success') {
        toast.success(result.toast.message);
      }
      setRetryRunId(null);
      void revalidator.revalidate();
    } else {
      toast.error(result.error.message);
    }
  }, [actionFetcher.data, revalidator]);

  const breadcrumbs = useMemo(
    () => [
      { label: 'Home', href: '/' },
      { label: 'Ingestion', href: '/ingestion' },
      { label: 'History', href: location.pathname },
    ],
    [location.pathname]
  );

  const updateSearchParams = (updates: (params: URLSearchParams) => void) => {
    const next = new URLSearchParams(location.search);
    updates(next);
    void navigate({ search: `?${next.toString()}` }, { replace: false });
  };

  const tabs = [
    { label: 'Overview', value: 'overview', to: '/ingestion' },
    { label: 'History', value: 'history', to: '/ingestion/history' },
    { label: 'Schedule', value: 'schedule', to: '/ingestion/schedule' },
  ];

  return (
    <div className="space-y-4">
      <Breadcrumbs items={breadcrumbs} />

      <div className="flex flex-wrap items-center gap-4">
        <Tabs
          items={tabs.map((tab) => ({ label: tab.label, value: tab.value }))}
          value="history"
          onValueChange={(v) => {
            const target = tabs.find((t) => t.value === v)?.to ?? '/ingestion';
            void navigate(target);
          }}
        />
      </div>

      <PolarisCard className="p-4">
        <IngestionHistoryTable
          runs={runs}
          total={total}
          page={page}
          limit={limit}
          statusFilter={status}
          sortKey={sort}
          sortDir={dir}
          expandedRunId={errorsForRunId}
          expandedContent={(runId) => (
            <div className="space-y-3">
              <div className="text-h4">Errors for run {runId}</div>
              {errors.length === 0 ? (
                <div className="text-caption text-muted">Nu exista detalii de eroare.</div>
              ) : (
                errors.map((error) => (
                  <ErrorDetailsRow
                    key={error.id}
                    error={error}
                    expanded={Boolean(expandedErrors[error.id])}
                    onToggle={() =>
                      setExpandedErrors((prev) => ({
                        ...prev,
                        [error.id]: !prev[error.id],
                      }))
                    }
                  />
                ))
              )}
            </div>
          )}
          onStatusChange={(value) =>
            updateSearchParams((p) => {
              p.set('status', value);
              p.set('page', '0');
            })
          }
          onSortChange={(key) =>
            updateSearchParams((p) => {
              const isSame = p.get('sort') === key;
              const nextDir = isSame && p.get('dir') !== 'asc' ? 'asc' : 'desc';
              p.set('sort', key);
              p.set('dir', nextDir);
            })
          }
          onPageChange={(nextPage) =>
            updateSearchParams((p) => {
              p.set('page', String(nextPage));
            })
          }
          onToggleErrors={(runId) =>
            updateSearchParams((p) => {
              const current = p.get('runId');
              if (current === runId) {
                p.delete('runId');
              } else {
                p.set('runId', runId);
              }
            })
          }
          onRetry={(runId) => setRetryRunId(runId)}
          onViewLogs={(runId) => {
            void navigate(`/ingestion?runId=${encodeURIComponent(runId)}`);
          }}
        />

        {errorsForRunId ? null : null}
      </PolarisCard>

      <RetryDialog
        open={Boolean(retryRunId)}
        runId={retryRunId}
        checkpointLabel={retryCheckpointLabel}
        recordsProcessed={retryRun?.recordsProcessed ?? null}
        onCancel={() => setRetryRunId(null)}
        onConfirm={(mode) => {
          if (!retryRunId) return;
          const formData = new FormData();
          formData.set('intent', 'bulk.retry');
          formData.set('runId', retryRunId);
          formData.set('mode', mode);
          void actionFetcher.submit(formData, { method: 'post' });
        }}
        loading={actionFetcher.state !== 'idle'}
      />
    </div>
  );
}
