import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  UNSAFE_DataWithResponseInit,
} from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import {
  data,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
  useRevalidator,
} from 'react-router-dom';
import { toast } from 'sonner';

import { useScrollReveal } from '../hooks/useScrollReveal';
import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { PageHeader } from '../components/layout/page-header';
import { ErrorState } from '../components/patterns/error-state';
import { LoadingState } from '../components/patterns/loading-state.js';
import { Button } from '../components/ui/button';
import { Select } from '../components/ui/select';
import { InfoTooltip } from '../components/ui/info-tooltip';
import { Tabs } from '../components/ui/tabs';
import { Card } from '../components/ui/card';
import { useQueueStream } from '../hooks/use-queue-stream';
import { ApiError } from '../utils/api-error';
import { getQueueDisplayInfo } from '../utils/queue-display';
import {
  apiLoader,
  createLoaderApiClient,
  type LoaderData,
  withShopifyQueryRedirect,
} from '../utils/loaders';

import {
  apiAction,
  type ActionData as RRActionData,
  createActionApiClient,
} from '../utils/actions';

import { ConfirmDialog } from '../components/domain/confirm-dialog';
import { JobsTable, type QueueJobListItem } from '../components/domain/jobs-table';
import { JobDetailModal, type QueueJobDetail } from '../components/domain/job-detail-modal';
import {
  QueueMetricsCharts,
  type QueueMetricsPoint,
} from '../components/domain/queue-metrics-charts';
import { WorkersGrid, type WorkerSummary } from '../components/domain/workers-grid';
import { QueuesOverviewGrid } from '../components/domain/queue-overview-cards';
import { RealtimeQueueStatusWithCountdown } from '../components/domain/realtime-queue-status';
import { StreamingIndicator } from '../components/ui/streaming-indicator.js';

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

  if (selectedQueue) {
    try {
      const metricsRes = await api.getApi<{ points: QueueMetricsPoint[] }>(
        `/queues/${encodeURIComponent(selectedQueue)}/metrics`
      );
      metricsPoints = metricsRes.points;
    } catch (err) {
      metricsError = err instanceof Error ? err.message : 'Încărcarea metricilor a eșuat';
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
        jobDetailError = err.status === 404 ? 'Job negăsit' : err.message;
      } else {
        jobDetailError = err instanceof Error ? err.message : 'Încărcarea jobului a eșuat';
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
  | 'queue.cleanFailed'
  | 'job.retry'
  | 'job.promote'
  | 'job.delete'
  | 'job.dlqReplay';

type QueuesActionResult =
  | {
      ok: true;
      intent: QueuesActionIntent;
      queue: string;
      jobIds: string[];
      toast?: { type: 'success' | 'error'; message: string };
    }
  | {
      ok: false;
      error: { code: string; message: string };
    };

type QueuesActionData = RRActionData<typeof action>;

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

type QueuesActionReturn =
  | Response
  | QueuesActionResult
  | UNSAFE_DataWithResponseInit<QueuesActionResult>;

export const action: (args: ActionFunctionArgs) => Promise<QueuesActionReturn> =
  apiAction<QueuesActionReturn>(async (args: ActionFunctionArgs) => {
    const api = createActionApiClient();
    const url = new URL(args.request.url);
    const formData = await args.request.formData();

    const currentJobId = url.searchParams.get('jobId') ?? '';

    const intent = getFormString(formData, 'intent') as QueuesActionIntent;
    const queue = getFormString(formData, 'queue');
    const jobIds = getFormStringArray(formData, 'jobId');

    if (!intent) {
      return data(
        {
          ok: false,
          error: { code: 'missing_intent', message: 'Missing intent' },
        } satisfies QueuesActionResult,
        { status: 400 }
      );
    }

    if (!queue) {
      return data(
        {
          ok: false,
          error: { code: 'missing_queue', message: 'Missing queue' },
        } satisfies QueuesActionResult,
        { status: 400 }
      );
    }

    if (intent === 'queue.pause' || intent === 'queue.resume' || intent === 'queue.cleanFailed') {
      if (intent === 'queue.pause') {
        await api.postApi(`/queues/${encodeURIComponent(queue)}/pause`, {});
        return data({
          ok: true,
          intent,
          queue,
          jobIds: [],
          toast: { type: 'success', message: 'Coada a fost pusă pe pauză' },
        } satisfies QueuesActionResult);
      }

      if (intent === 'queue.resume') {
        await api.postApi(`/queues/${encodeURIComponent(queue)}/resume`, {});
        return data({
          ok: true,
          intent,
          queue,
          jobIds: [],
          toast: { type: 'success', message: 'Coada a fost reluată' },
        } satisfies QueuesActionResult);
      }

      await api.getApi(`/queues/${encodeURIComponent(queue)}/jobs/failed`, { method: 'DELETE' });
      return data({
        ok: true,
        intent,
        queue,
        jobIds: [],
        toast: { type: 'success', message: 'Job-urile eșuate au fost șterse' },
      } satisfies QueuesActionResult);
    }

    if (intent === 'job.dlqReplay') {
      if (jobIds.length === 0) {
        return data(
          {
            ok: false,
            error: { code: 'missing_jobId', message: 'Missing jobId' },
          } satisfies QueuesActionResult,
          { status: 400 }
        );
      }
      if (!queue.endsWith('-dlq')) {
        return data(
          {
            ok: false,
            error: { code: 'not_dlq_queue', message: 'Not a DLQ queue' },
          } satisfies QueuesActionResult,
          { status: 400 }
        );
      }

      const result = await api.postApi<{ replayed: number; failed: number }, { jobIds: string[] }>(
        `/queues/${encodeURIComponent(queue)}/dlq/replay`,
        { jobIds }
      );

      return data({
        ok: true,
        intent,
        queue,
        jobIds,
        toast: {
          type: 'success',
          message: `Reia din DLQ: ${result.replayed} job-uri${result.failed ? `, ${result.failed} esuate` : ''}`,
        },
      } satisfies QueuesActionResult);
    }

    if (intent === 'job.retry' || intent === 'job.promote' || intent === 'job.delete') {
      if (jobIds.length === 0) {
        return data(
          {
            ok: false,
            error: { code: 'missing_jobId', message: 'Missing jobId' },
          } satisfies QueuesActionResult,
          { status: 400 }
        );
      }

      if (jobIds.length > 100) {
        return data(
          {
            ok: false,
            error: { code: 'too_many_jobIds', message: 'Select at most 100 jobs' },
          } satisfies QueuesActionResult,
          { status: 400 }
        );
      }

      const actionName =
        intent === 'job.retry' ? 'retry' : intent === 'job.promote' ? 'promote' : 'delete';

      if (jobIds.length === 1) {
        const id = jobIds[0];
        if (!id) {
          return data(
            {
              ok: false,
              error: { code: 'missing_jobId', message: 'Missing jobId' },
            } satisfies QueuesActionResult,
            { status: 400 }
          );
        }

        if (actionName === 'retry') {
          await api.postApi(
            `/queues/${encodeURIComponent(queue)}/jobs/${encodeURIComponent(id)}/retry`,
            {}
          );
        } else if (actionName === 'promote') {
          await api.postApi(
            `/queues/${encodeURIComponent(queue)}/jobs/${encodeURIComponent(id)}/promote`,
            {}
          );
        } else {
          await api.getApi(`/queues/${encodeURIComponent(queue)}/jobs/${encodeURIComponent(id)}`, {
            method: 'DELETE',
          });
        }
      } else {
        await api.postApi('/queues/jobs/batch', {
          action: actionName,
          ids: jobIds,
          queueName: queue,
        });
      }

      // URL must change if the currently opened job was deleted.
      if (actionName === 'delete' && currentJobId && jobIds.includes(currentJobId)) {
        const next = new URL(url);
        next.searchParams.delete('jobId');
        return withShopifyQueryRedirect(args, next.pathname + next.search);
      }

      return data({
        ok: true,
        intent,
        queue,
        jobIds,
        toast: { type: 'success', message: 'Acțiunea a fost executată' },
      } satisfies QueuesActionResult);
    }

    return data(
      {
        ok: false,
        error: { code: 'unknown_intent', message: 'Unknown intent' },
      } satisfies QueuesActionResult,
      { status: 400 }
    );
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

  const [lastSnapshotAt, setLastSnapshotAt] = useState<number | null>(null);
  const [showRefreshBurst, setShowRefreshBurst] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const refreshBurstTimerRef = useRef<number | null>(null);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[]>([]);

  const refreshJobsTimerRef = useRef<number | null>(null);

  const queueActionFetcher = useFetcher<QueuesActionData>();
  const jobActionFetcher = useFetcher<QueuesActionData>();

  const queueMutating = queueActionFetcher.state !== 'idle';
  const jobMutating = jobActionFetcher.state !== 'idle';

  useEffect(() => {
    const items = [queueActionFetcher.data, jobActionFetcher.data];
    for (const data of items) {
      if (!data) continue;
      if (data.ok) {
        if (data.toast?.type === 'success') toast.success(data.toast.message);
      } else {
        toast.error(data.error.message);
      }
    }
  }, [jobActionFetcher.data, queueActionFetcher.data]);

  const [overviewSectionRef] = useScrollReveal<HTMLDivElement>({ rootMargin: '0px 0px -40px 0px' });

  const breadcrumbs = useMemo(
    () => [
      { label: 'Acasă', href: '/' },
      { label: 'Cozi', href: location.pathname },
    ],
    [location.pathname]
  );

  const queueOptions = useMemo(
    () => queues.map((q) => ({ label: getQueueDisplayInfo(q.name).labelRo, value: q.name })),
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

  const submitQueueActionFor = useCallback(
    (queueName: string, nextIntent: QueuesActionIntent) => {
      const formData = new FormData();
      formData.set('intent', nextIntent);
      formData.set('queue', queueName);
      void queueActionFetcher.submit(formData, { method: 'post' });
    },
    [queueActionFetcher]
  );

  const submitJobAction = useCallback(
    (nextIntent: QueuesActionIntent, ids: string[]) => {
      if (!selectedQueue) return;
      if (ids.length === 0) return;

      if (ids.length > 100) {
        toast.error('Selectează maxim 100 de joburi');
        return;
      }

      const formData = new FormData();
      formData.set('intent', nextIntent);
      formData.set('queue', selectedQueue);
      for (const id of ids) formData.append('jobId', id);
      void jobActionFetcher.submit(formData, { method: 'post' });
    },
    [jobActionFetcher, selectedQueue]
  );

  const performJobAction = useCallback(
    (next: 'retry' | 'delete' | 'promote' | 'dlq_replay', ids: string[]) => {
      if (next === 'delete') {
        setConfirmDeleteIds(ids);
        setConfirmDeleteOpen(true);
        return;
      }

      if (next === 'dlq_replay') {
        submitJobAction('job.dlqReplay', ids);
        return;
      }

      submitJobAction(next === 'retry' ? 'job.retry' : 'job.promote', ids);
    },
    [submitJobAction]
  );

  const confirmDelete = useCallback(() => {
    const ids = confirmDeleteIds;
    closeConfirmDelete();
    submitJobAction('job.delete', ids);
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
        const list = Array.isArray(q) ? q : [];
        const parsed: QueueSummary[] = list
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

        const isInitialEmpty = Boolean(evt.data['initial']) && parsed.length === 0;
        if (!isInitialEmpty) setQueues(parsed);
        setLastSnapshotAt(Date.now());
        setShowRefreshBurst(true);
        if (evt.data['error'])
          setSnapshotError(
            typeof evt.data['error'] === 'string'
              ? evt.data['error']
              : 'Actualizarea snapshot-ului a eșuat'
          );
        else setSnapshotError(null);
        if (refreshBurstTimerRef.current) window.clearTimeout(refreshBurstTimerRef.current);
        refreshBurstTimerRef.current = window.setTimeout(() => {
          setShowRefreshBurst(false);
          refreshBurstTimerRef.current = null;
        }, 600);
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

  useEffect(() => {
    return () => {
      if (refreshBurstTimerRef.current) window.clearTimeout(refreshBurstTimerRef.current);
    };
  }, []);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={breadcrumbs} />
      <div className="flex items-center gap-3">
        <PageHeader
          title="Monitor cozi"
          description="Monitorizare cozi, job-uri și workeri în timp real"
        />
        <StreamingIndicator
          active={stream.connected}
          label="Stream activ"
          variant="success"
          showLabel
        />
      </div>

      <Card variant="glass" padding="md">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-64">
            <div className="flex items-center gap-1.5">
              <div className="min-w-64">
                <Select
                  label="Queue"
                  value={selectedQueue}
                  options={queueOptions}
                  onChange={(e) => {
                    const next = e.target.value;
                    updateSearchParams(navigate, location.search, (p) => {
                      p.set('queue', next);
                      p.delete('jobId');
                      p.set('page', '0');
                    });
                  }}
                />
              </div>
              <InfoTooltip title="Selectare coadă" side="bottom">
                Alege coada pentru care vezi metricile și job-urile. Fiecare coadă procesează un tip
                de job (sincronizare, webhooks, enrichment etc.). După selecție, metricile și lista
                de job-uri se actualizează.
              </InfoTooltip>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <RealtimeQueueStatusWithCountdown
              connected={stream.connected}
              lastSnapshotAt={lastSnapshotAt}
              showRefreshBurst={showRefreshBurst}
              error={stream.error}
              snapshotError={snapshotError}
            />
            <span className="inline-flex items-center gap-1.5">
              <Button
                variant="secondary"
                onClick={() => {
                  void revalidator.revalidate();
                }}
              >
                Reîncarcă
              </Button>
              <InfoTooltip title="Reîncarcă" side="bottom">
                Reîmprospătează datele afișate pe pagină (lista de cozi, numerele din carduri,
                metricile sau lista de workeri) fără a modifica nimic în cozi. Util după ce ai făcut
                acțiuni (pauză, retry, ștergere) sau când vrei să vezi starea actuală.
              </InfoTooltip>
            </span>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-4">
        <span className="inline-flex items-center gap-1.5">
          <Tabs
            items={[
              { label: 'Prezentare', value: 'overview' },
              { label: 'Job-uri', value: 'jobs' },
              { label: 'Workeri', value: 'workers' },
            ]}
            value={tab}
            onValueChange={(v) =>
              updateSearchParams(navigate, location.search, (p) => {
                p.set('tab', v);
                p.delete('jobId');
              })
            }
          />
          <InfoTooltip title="Tab-uri monitor cozi" side="bottom">
            Prezentare: carduri cu statistici per coadă și acțiuni (Pauză, Reia, Șterge eșecuri).
            Job-uri: listă job-uri cu filtrare, căutare și acțiuni (Retry, Promovare, Ștergere).
            Workeri: procesoare conectate care execută job-urile.
          </InfoTooltip>
        </span>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {isLoading
          ? 'Se încarcă...'
          : `${queues.length} cozi disponibile, coada selectată: ${selectedQueue || 'niciuna'}`}
      </p>

      {selectedQueue ? (
        <>
          <section
            aria-labelledby="queue-metrics-heading"
            className="grid grid-cols-1 gap-4 lg:grid-cols-3"
          >
            <h2 id="queue-metrics-heading" className="sr-only">
              Metrici coadă selectată
            </h2>
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
          </section>
          {metricsError ? (
            <ErrorState
              message={metricsError}
              onRetry={() => {
                void revalidator.revalidate();
              }}
            />
          ) : null}
        </>
      ) : null}

      {tab === 'overview' ? (
        <div
          className="space-y-6 motion-safe:animate-[fadeIn_0.3s_ease-out]"
          ref={overviewSectionRef}
        >
          <section aria-labelledby="queues-overview-heading">
            <h2 id="queues-overview-heading" className="sr-only">
              Prezentare cozi
            </h2>
            <p className="mb-4 text-sm text-muted">
              Fiecare card reprezintă o coadă: statistici în timp real și acțiuni (Pauză, Reia,
              Șterge eșecuri). Apasă pe numele cozii pentru a o selecta și a vedea metricile mai
              sus.
            </p>
            <QueuesOverviewGrid
              queues={queues}
              selectedQueue={selectedQueue}
              mutating={queueMutating || isLoading}
              onSelectQueue={(queueName) =>
                updateSearchParams(navigate, location.search, (p) => {
                  p.set('queue', queueName);
                  p.delete('jobId');
                  p.set('page', '0');
                })
              }
              onPause={(queueName) => submitQueueActionFor(queueName, 'queue.pause')}
              onResume={(queueName) => submitQueueActionFor(queueName, 'queue.resume')}
              onCleanFailed={(queueName) => submitQueueActionFor(queueName, 'queue.cleanFailed')}
            />
          </section>
        </div>
      ) : null}

      {tab === 'jobs' ? (
        <div className="space-y-3 motion-safe:animate-[fadeIn_0.3s_ease-out]">
          {selectedQueue ? (
            <JobsTable
              jobs={jobs}
              total={jobsTotal}
              page={jobsPage}
              limit={jobsLimit}
              status={jobsStatus}
              search={jobsSearch}
              loading={isLoading || jobMutating}
              dlqReplayEnabled={selectedQueue.endsWith('-dlq')}
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
                void performJobAction(action as 'retry' | 'delete' | 'promote' | 'dlq_replay', ids);
              }}
              onOpenDetails={(id) => openJobDetails(id)}
            />
          ) : null}
        </div>
      ) : null}

      {tab === 'workers' ? (
        <div className="space-y-4 motion-safe:animate-[fadeIn_0.3s_ease-out]">
          <Card
            variant="glass"
            padding="md"
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3">
              {isLoading ? (
                <LoadingState label="Se încarcă…" />
              ) : (
                <span className="text-sm font-medium text-foreground">
                  <span className="tabular-nums">{workers.length}</span>
                  <span className="ml-1 text-muted">
                    {workers.length === 1 ? 'worker' : 'workeri'}
                  </span>
                </span>
              )}
              {!isLoading && workers.length > 0 ? (
                <span className="text-xs text-muted">
                  ({workers.filter((w) => w.ok).length} online)
                </span>
              ) : null}
            </div>
            <span className="inline-flex items-center gap-1.5">
              <Button
                variant="secondary"
                onClick={() => {
                  void revalidator.revalidate();
                }}
              >
                Reîncarcă
              </Button>
              <InfoTooltip title="Reîncarcă workeri" side="bottom">
                Reîmprospătează lista de workeri și starea lor curentă (ce job procesează, dacă sunt
                conectați). Nu modifică nimic în cozi sau în aplicație.
              </InfoTooltip>
            </span>
          </Card>
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
        title={confirmDeleteIds.length === 1 ? 'Ștergi job-ul?' : 'Ștergi job-urile?'}
        message={
          confirmDeleteIds.length === 1
            ? `Ștergi job-ul ${confirmDeleteIds[0] ?? ''}? Acțiunea este ireversibilă.`
            : `Ștergi ${confirmDeleteIds.length} job-uri? Acțiunea este ireversibilă.`
        }
        confirmLabel={confirmDeleteIds.length === 1 ? 'Șterge job' : 'Șterge job-uri'}
        cancelLabel="Renunță"
        confirmTone="critical"
        confirmDisabled={jobMutating}
        confirmLoading={jobMutating}
        cancelDisabled={jobMutating}
        onCancel={closeConfirmDelete}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
