import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import {
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
  useRevalidator,
} from 'react-router-dom';
import { toast } from 'sonner';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { ErrorState } from '../components/patterns/error-state';
import {
  PolarisBadge,
  PolarisButton,
  PolarisCard,
  PolarisSelect,
} from '../../components/polaris/index.js';
import { useQueueStream } from '../hooks/use-queue-stream';
import { ApiError } from '../utils/api-error';
import {
  apiAction,
  apiLoader,
  createLoaderApiClient,
  type LoaderData,
  withShopifyQueryRedirect,
} from '../utils/loaders';

import { ConfirmDialog } from '../components/domain/confirm-dialog';
import { JobsTable, type QueueJobListItem } from '../components/domain/jobs-table';
import { JobDetailModal, type QueueJobDetail } from '../components/domain/job-detail-modal';
import {
  QueueMetricsCharts,
  type QueueMetricsPoint,
} from '../components/domain/queue-metrics-charts';
import { WorkersGrid, type WorkerSummary } from '../components/domain/workers-grid';

type QueueSummary = Readonly<{
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}>;

type Tab = 'overview' | 'jobs' | 'workers';

function parseTab(value: string | null): Tab {
  if (value === 'jobs' || value === 'workers' || value === 'overview') return value;
  return 'overview';
}

function parseNonNegativeInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const loader = apiLoader(async (args: LoaderFunctionArgs) => {
  const api = createLoaderApiClient();
  const url = new URL(args.request.url);

  // Test helpers (used by routing.test.tsx)
  const mode = url.searchParams.get('mode');
  if (mode === '404') {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw new Response('Not Found', { status: 404 });
  }
  if (mode === '500') {
    throw new Error('Simulated server error');
  }

  const tab = parseTab(url.searchParams.get('tab'));
  const requestedQueue = url.searchParams.get('queue') ?? '';
  const jobId = url.searchParams.get('jobId');

  const jobsStatus = url.searchParams.get('status') ?? 'waiting';
  const jobsPage = parseNonNegativeInt(url.searchParams.get('page'), 0);
  const jobsLimit = parsePositiveInt(url.searchParams.get('limit'), 50);
  const jobsSearch = url.searchParams.get('q') ?? '';

  const queuesRes = await api.getApi<{ queues: QueueSummary[] }>('/queues');
  const queues = queuesRes.queues;

  const firstQueueName = queues[0]?.name ?? '';
  const selectedQueue =
    requestedQueue && queues.some((q) => q.name === requestedQueue)
      ? requestedQueue
      : firstQueueName;

  // Make server state shareable/predictable: always normalize `queue=` in the URL.
  if (selectedQueue && requestedQueue !== selectedQueue) {
    const next = new URL(url);
    next.searchParams.set('queue', selectedQueue);
    next.searchParams.delete('jobId');
    return withShopifyQueryRedirect(args, next.pathname + next.search);
  }

  let metricsPoints: QueueMetricsPoint[] = [];
  let metricsError: string | null = null;

  if (tab === 'overview' && selectedQueue) {
    try {
      const metricsRes = await api.getApi<{ points: QueueMetricsPoint[] }>(
        `/queues/${encodeURIComponent(selectedQueue)}/metrics`
      );
      metricsPoints = metricsRes.points;
    } catch (err) {
      metricsError = err instanceof Error ? err.message : 'failed_to_load_metrics';
    }
  }

  let jobs: QueueJobListItem[] = [];
  let jobsTotal = 0;

  if (tab === 'jobs' && selectedQueue) {
    const q = new URLSearchParams();
    q.set('status', jobsStatus);
    q.set('page', String(jobsPage));
    q.set('limit', String(jobsLimit));
    if (jobsSearch.trim().length) q.set('q', jobsSearch.trim());

    const jobsRes = await api.getApi<{
      jobs: QueueJobListItem[];
      total: number;
    }>(`/queues/${encodeURIComponent(selectedQueue)}/jobs?${q.toString()}`);

    jobs = jobsRes.jobs;
    jobsTotal = jobsRes.total ?? jobsRes.jobs.length;
  }

  let workers: WorkerSummary[] = [];
  if (tab === 'workers') {
    const workersRes = await api.getApi<{ workers: WorkerSummary[] }>('/queues/workers');
    workers = workersRes.workers;
  }

  let jobDetail: QueueJobDetail | null = null;
  let jobDetailError: string | null = null;

  if (tab === 'jobs' && selectedQueue && jobId) {
    try {
      const jobRes = await api.getApi<{ job: QueueJobDetail }>(
        `/queues/${encodeURIComponent(selectedQueue)}/jobs/${encodeURIComponent(jobId)}`
      );
      jobDetail = jobRes.job;
    } catch (err) {
      if (err instanceof ApiError) {
        jobDetailError = err.status === 404 ? 'Job not found' : err.message;
      } else {
        jobDetailError = err instanceof Error ? err.message : 'failed_to_load_job';
      }
    }
  }

  return {
    tab,
    queues,
    selectedQueue,
    metricsPoints,
    metricsError,
    jobs,
    jobsTotal,
    jobsStatus,
    jobsPage,
    jobsLimit,
    jobsSearch,
    workers,
    jobId,
    jobDetail,
    jobDetailError,
  };
});

type QueuesActionIntent =
  | 'queue.pause'
  | 'queue.resume'
  | 'queue.clean_failed'
  | 'jobs.retry'
  | 'jobs.promote'
  | 'jobs.delete';

type ActionData =
  | { ok: true; toast?: { type: 'success' | 'error'; message: string } }
  | { ok: false; error: string };

function jsonResponse<T>(data: T, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

function getFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function getFormStringArray(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .map((v) => (typeof v === 'string' ? v : ''))
    .filter((v) => v.length > 0);
}

export const action = apiAction(async (args: ActionFunctionArgs) => {
  const api = createLoaderApiClient();
  const url = new URL(args.request.url);
  const formData = await args.request.formData();

  const intent = getFormString(formData, 'intent') as QueuesActionIntent;
  const queueName = getFormString(formData, 'queueName');
  const ids = getFormStringArray(formData, 'ids');
  const activeJobId = getFormString(formData, 'activeJobId');

  if (!intent) {
    return jsonResponse({ ok: false, error: 'missing_intent' } satisfies ActionData, {
      status: 400,
    });
  }

  if (!queueName) {
    return jsonResponse({ ok: false, error: 'missing_queueName' } satisfies ActionData, {
      status: 400,
    });
  }

  if (intent === 'queue.pause' || intent === 'queue.resume' || intent === 'queue.clean_failed') {
    if (intent === 'queue.pause') {
      await api.postApi(`/queues/${encodeURIComponent(queueName)}/pause`, {});
      return jsonResponse({
        ok: true,
        toast: { type: 'success', message: 'Queue paused' },
      } satisfies ActionData);
    }

    if (intent === 'queue.resume') {
      await api.postApi(`/queues/${encodeURIComponent(queueName)}/resume`, {});
      return jsonResponse({
        ok: true,
        toast: { type: 'success', message: 'Queue resumed' },
      } satisfies ActionData);
    }

    await api.getApi(`/queues/${encodeURIComponent(queueName)}/jobs/failed`, { method: 'DELETE' });
    return jsonResponse({
      ok: true,
      toast: { type: 'success', message: 'Failed jobs cleaned' },
    } satisfies ActionData);
  }

  if (intent === 'jobs.retry' || intent === 'jobs.promote' || intent === 'jobs.delete') {
    if (ids.length === 0) {
      return jsonResponse({ ok: false, error: 'missing_ids' } satisfies ActionData, {
        status: 400,
      });
    }

    if (ids.length > 100) {
      return jsonResponse({ ok: false, error: 'too_many_ids' } satisfies ActionData, {
        status: 400,
      });
    }

    const actionName =
      intent === 'jobs.retry' ? 'retry' : intent === 'jobs.promote' ? 'promote' : 'delete';

    if (ids.length === 1) {
      const id = ids[0];
      if (!id) {
        return jsonResponse({ ok: false, error: 'missing_id' } satisfies ActionData, {
          status: 400,
        });
      }

      if (actionName === 'retry') {
        await api.postApi(
          `/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(id)}/retry`,
          {}
        );
      } else if (actionName === 'promote') {
        await api.postApi(
          `/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(id)}/promote`,
          {}
        );
      } else {
        await api.getApi(
          `/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(id)}`,
          { method: 'DELETE' }
        );
      }
    } else {
      await api.postApi('/queues/jobs/batch', {
        action: actionName,
        ids,
        queueName,
      });
    }

    // URL must change if the currently opened job was deleted.
    if (actionName === 'delete' && activeJobId && ids.includes(activeJobId)) {
      const next = new URL(url);
      next.searchParams.delete('jobId');
      return withShopifyQueryRedirect(args, next.pathname + next.search);
    }

    return jsonResponse({
      ok: true,
      toast: { type: 'success', message: 'Action completed' },
    } satisfies ActionData);
  }

  return jsonResponse({ ok: false, error: 'unknown_intent' } satisfies ActionData, {
    status: 400,
  });
});

type RouteLoaderData = LoaderData<typeof loader>;

function updateSearchParams(
  navigate: NavigateFunction,
  locationSearch: string,
  updates: (params: URLSearchParams) => void
) {
  const next = new URLSearchParams(locationSearch);
  updates(next);
  void navigate({ search: `?${next.toString()}` }, { replace: false });
}

export default function QueuesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const isLoading = navigation.state === 'loading' || revalidator.state === 'loading';

  const {
    tab,
    queues: loaderQueues,
    selectedQueue,
    metricsPoints,
    metricsError,
    jobs,
    jobsTotal,
    jobsStatus,
    jobsPage,
    jobsLimit,
    jobsSearch,
    workers,
    jobId,
    jobDetail,
    jobDetailError,
  } = useLoaderData<RouteLoaderData>();

  const [queues, setQueues] = useState<QueueSummary[]>(loaderQueues);
  useEffect(() => {
    setQueues(loaderQueues);
  }, [loaderQueues]);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[]>([]);

  const refreshJobsTimerRef = useRef<number | null>(null);

  const mutationFetcher = useFetcher<ActionData>();

  useEffect(() => {
    const data = mutationFetcher.data;
    if (!data) return;

    if (data.ok) {
      if (data.toast?.type === 'success') toast.success(data.toast.message);
      if (data.toast?.type === 'error') toast.error(data.toast.message);
      return;
    }

    toast.error('Action failed');
  }, [mutationFetcher.data]);

  const breadcrumbs = useMemo(
    () => [
      { label: 'Home', href: '/' },
      { label: 'Queues', href: location.pathname },
    ],
    [location.pathname]
  );

  const queueOptions = useMemo(
    () => queues.map((q) => ({ label: q.name, value: q.name })),
    [queues]
  );

  const selectedQueueSummary = useMemo(
    () => queues.find((q) => q.name === selectedQueue) ?? null,
    [queues, selectedQueue]
  );

  const openJobDetails = useCallback(
    (nextJobId: string) => {
      if (!selectedQueue) return;
      updateSearchParams(navigate, location.search, (p) => {
        p.set('tab', 'jobs');
        p.set('queue', selectedQueue);
        p.set('jobId', nextJobId);
      });
    },
    [location.search, navigate, selectedQueue]
  );

  const closeJobDetails = useCallback(() => {
    updateSearchParams(navigate, location.search, (p) => {
      p.delete('jobId');
    });
  }, [location.search, navigate]);

  const closeConfirmDelete = useCallback(() => {
    setConfirmDeleteOpen(false);
    setConfirmDeleteIds([]);
  }, []);

  const submitQueueAction = useCallback(
    (nextIntent: QueuesActionIntent) => {
      if (!selectedQueue) return;
      const formData = new FormData();
      formData.set('intent', nextIntent);
      formData.set('queueName', selectedQueue);
      void mutationFetcher.submit(formData, { method: 'post' });
    },
    [mutationFetcher, selectedQueue]
  );

  const submitJobAction = useCallback(
    (nextIntent: QueuesActionIntent, ids: string[]) => {
      if (!selectedQueue) return;
      if (ids.length === 0) return;

      if (ids.length > 100) {
        toast.error('Select at most 100 jobs');
        return;
      }

      const formData = new FormData();
      formData.set('intent', nextIntent);
      formData.set('queueName', selectedQueue);
      if (jobId) formData.set('activeJobId', jobId);
      for (const id of ids) formData.append('ids', id);
      void mutationFetcher.submit(formData, { method: 'post' });
    },
    [jobId, mutationFetcher, selectedQueue]
  );

  const performJobAction = useCallback(
    (next: 'retry' | 'delete' | 'promote', ids: string[]) => {
      if (next === 'delete') {
        setConfirmDeleteIds(ids);
        setConfirmDeleteOpen(true);
        return;
      }

      submitJobAction(next === 'retry' ? 'jobs.retry' : 'jobs.promote', ids);
    },
    [submitJobAction]
  );

  const confirmDelete = useCallback(() => {
    const ids = confirmDeleteIds;
    closeConfirmDelete();
    submitJobAction('jobs.delete', ids);
  }, [closeConfirmDelete, confirmDeleteIds, submitJobAction]);

  useEffect(() => {
    if (tab !== 'workers') return;
    const id = window.setInterval(() => {
      void revalidator.revalidate();
    }, 5_000);
    return () => window.clearInterval(id);
  }, [revalidator, tab]);

  const stream = useQueueStream({
    enabled: true,
    onEvent: (evt) => {
      if (evt.type === 'queues.snapshot') {
        const q = evt.data['queues'];
        if (Array.isArray(q)) {
          const parsed: QueueSummary[] = q
            .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null))
            .filter((x): x is Record<string, unknown> => Boolean(x))
            .map((x) => ({
              name: typeof x['name'] === 'string' ? x['name'] : '',
              waiting: Number(x['waiting'] ?? 0),
              active: Number(x['active'] ?? 0),
              completed: Number(x['completed'] ?? 0),
              failed: Number(x['failed'] ?? 0),
              delayed: Number(x['delayed'] ?? 0),
            }))
            .filter((x) => x.name.length > 0);

          if (parsed.length) {
            setQueues(parsed);
          }
        }
      }

      if (
        (evt.type === 'job.started' || evt.type === 'job.completed' || evt.type === 'job.failed') &&
        tab === 'jobs'
      ) {
        const qn = typeof evt.data['queueName'] === 'string' ? evt.data['queueName'] : '';
        if (qn && qn === selectedQueue) {
          if (refreshJobsTimerRef.current) window.clearTimeout(refreshJobsTimerRef.current);
          refreshJobsTimerRef.current = window.setTimeout(() => {
            void revalidator.revalidate();
          }, 700);
        }
      }

      if (evt.type === 'worker.online' || evt.type === 'worker.offline') {
        if (tab === 'workers') {
          void revalidator.revalidate();
        }
      }
    },
  });

  return (
    <div className="space-y-4">
      <Breadcrumbs items={breadcrumbs} />
      <h1 className="text-h2">Queue Monitor</h1>

      <PolarisCard className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-64">
            <PolarisSelect
              label="Queue"
              value={selectedQueue}
              options={queueOptions}
              onChange={(e) => {
                const next = (e.target as HTMLSelectElement).value;
                updateSearchParams(navigate, location.search, (p) => {
                  p.set('queue', next);
                  p.delete('jobId');
                  p.set('page', '0');
                });
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <PolarisBadge tone={stream.connected ? 'success' : 'warning'}>
              {stream.connected ? 'Live' : 'Offline'}
            </PolarisBadge>
            {stream.error ? <span className="text-caption text-muted">{stream.error}</span> : null}
          </div>
        </div>
      </PolarisCard>

      <div className="flex flex-wrap gap-2">
        <PolarisButton
          variant={tab === 'overview' ? 'primary' : 'secondary'}
          onClick={() =>
            updateSearchParams(navigate, location.search, (p) => {
              p.set('tab', 'overview');
              p.delete('jobId');
            })
          }
        >
          Overview
        </PolarisButton>
        <PolarisButton
          variant={tab === 'jobs' ? 'primary' : 'secondary'}
          onClick={() =>
            updateSearchParams(navigate, location.search, (p) => {
              p.set('tab', 'jobs');
              p.delete('jobId');
            })
          }
        >
          Jobs
        </PolarisButton>
        <PolarisButton
          variant={tab === 'workers' ? 'primary' : 'secondary'}
          onClick={() =>
            updateSearchParams(navigate, location.search, (p) => {
              p.set('tab', 'workers');
              p.delete('jobId');
            })
          }
        >
          Workers
        </PolarisButton>

        <PolarisButton
          variant="secondary"
          onClick={() => {
            void revalidator.revalidate();
          }}
        >
          Refresh
        </PolarisButton>
      </div>

      {tab === 'overview' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <PolarisCard className="p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-h4">{selectedQueue || '—'}</div>
                  <div className="text-caption text-muted">Selected queue</div>
                </div>
                {isLoading ? <span className="text-caption text-muted">Loading…</span> : null}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <div className="text-caption text-muted">Waiting</div>
                  <div className="font-mono">{selectedQueueSummary?.waiting ?? '—'}</div>
                </div>
                <div>
                  <div className="text-caption text-muted">Active</div>
                  <div className="font-mono">{selectedQueueSummary?.active ?? '—'}</div>
                </div>
                <div>
                  <div className="text-caption text-muted">Failed</div>
                  <div className="font-mono">{selectedQueueSummary?.failed ?? '—'}</div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <PolarisButton variant="secondary" onClick={() => submitQueueAction('queue.pause')}>
                  Pause
                </PolarisButton>
                <PolarisButton
                  variant="secondary"
                  onClick={() => submitQueueAction('queue.resume')}
                >
                  Resume
                </PolarisButton>
                <PolarisButton
                  variant="critical"
                  onClick={() => submitQueueAction('queue.clean_failed')}
                >
                  Clean Failed
                </PolarisButton>
              </div>
            </PolarisCard>
            <PolarisCard className="p-4 lg:col-span-2">
              <div className="text-h4">Queues snapshot</div>
              <div className="mt-3 overflow-auto rounded-md border">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-muted/20">
                    <tr>
                      <th className="px-3 py-2 text-left">Queue</th>
                      <th className="px-3 py-2 text-left">Waiting</th>
                      <th className="px-3 py-2 text-left">Active</th>
                      <th className="px-3 py-2 text-left">Delayed</th>
                      <th className="px-3 py-2 text-left">Completed</th>
                      <th className="px-3 py-2 text-left">Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queues.map((q) => (
                      <tr
                        key={q.name}
                        className={
                          q.name === selectedQueue
                            ? 'bg-muted/10 border-b last:border-b-0'
                            : 'border-b last:border-b-0'
                        }
                      >
                        <td className="px-3 py-2 font-mono text-xs">
                          <button
                            type="button"
                            className="text-primary hover:underline"
                            onClick={() =>
                              updateSearchParams(navigate, location.search, (p) => {
                                p.set('queue', q.name);
                                p.delete('jobId');
                                p.set('page', '0');
                              })
                            }
                          >
                            {q.name}
                          </button>
                        </td>
                        <td className="px-3 py-2 font-mono">{q.waiting}</td>
                        <td className="px-3 py-2 font-mono">{q.active}</td>
                        <td className="px-3 py-2 font-mono">{q.delayed}</td>
                        <td className="px-3 py-2 font-mono">{q.completed}</td>
                        <td className="px-3 py-2 font-mono">{q.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </PolarisCard>
          </div>

          {selectedQueue ? (
            <QueueMetricsCharts
              points={metricsPoints}
              distribution={
                selectedQueueSummary
                  ? {
                      waiting: selectedQueueSummary.waiting,
                      active: selectedQueueSummary.active,
                      delayed: selectedQueueSummary.delayed,
                      failed: selectedQueueSummary.failed,
                      completed: selectedQueueSummary.completed,
                    }
                  : null
              }
            />
          ) : null}

          {metricsError ? (
            <ErrorState
              message={metricsError}
              onRetry={() => {
                void revalidator.revalidate();
              }}
            />
          ) : null}
        </div>
      ) : null}

      {tab === 'jobs' ? (
        <div className="space-y-3">
          {selectedQueue ? (
            <JobsTable
              jobs={jobs}
              total={jobsTotal}
              page={jobsPage}
              limit={jobsLimit}
              status={jobsStatus}
              search={jobsSearch}
              loading={isLoading}
              onSearchChange={(v) => {
                updateSearchParams(navigate, location.search, (p) => {
                  if (v.trim().length) {
                    p.set('q', v);
                  } else {
                    p.delete('q');
                  }
                  p.set('page', '0');
                });
              }}
              onStatusChange={(v) => {
                updateSearchParams(navigate, location.search, (p) => {
                  p.set('status', v);
                  p.set('page', '0');
                });
              }}
              onPageChange={(p) =>
                updateSearchParams(navigate, location.search, (sp) => {
                  sp.set('page', String(p));
                })
              }
              onLimitChange={(l) => {
                updateSearchParams(navigate, location.search, (sp) => {
                  sp.set('limit', String(l));
                  sp.set('page', '0');
                });
              }}
              onAction={(action, ids) => {
                if (action === 'details' && ids[0]) {
                  openJobDetails(ids[0]);
                  return;
                }
                void performJobAction(action as 'retry' | 'delete' | 'promote', ids);
              }}
              onOpenDetails={(id) => openJobDetails(id)}
            />
          ) : null}
        </div>
      ) : null}

      {tab === 'workers' ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-caption text-muted">
              {isLoading ? 'Loading…' : `${workers.length} workers`}
            </div>
            <PolarisButton
              variant="secondary"
              onClick={() => {
                void revalidator.revalidate();
              }}
            >
              Refresh
            </PolarisButton>
          </div>
          <WorkersGrid workers={workers} />
        </div>
      ) : null}

      <JobDetailModal
        open={Boolean(jobId)}
        queueName={selectedQueue}
        jobId={jobId ?? null}
        job={jobDetail}
        loading={isLoading}
        error={jobDetailError}
        onClose={closeJobDetails}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={confirmDeleteIds.length === 1 ? 'Delete job?' : 'Delete jobs?'}
        message={
          confirmDeleteIds.length === 1
            ? `Delete job ${confirmDeleteIds[0] ?? ''}? This action is irreversible.`
            : `Delete ${confirmDeleteIds.length} jobs? This action is irreversible.`
        }
        confirmLabel={confirmDeleteIds.length === 1 ? 'Delete job' : 'Delete jobs'}
        cancelLabel="Cancel"
        confirmTone="critical"
        onCancel={closeConfirmDelete}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
