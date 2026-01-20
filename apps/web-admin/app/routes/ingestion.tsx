import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router-dom';
import { data, useFetcher, useLoaderData, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useEffect, useMemo, useRef, useState } from 'react';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { Tabs } from '../components/ui/tabs';
import { Button } from '../components/ui/button';
import { FileUpload } from '../components/ui/FileUpload';
import { IngestionProgress, LogConsole } from '../components/domain/index.js';
import { PolarisCard } from '../../components/polaris/index.js';
import { useLogStream } from '../hooks/use-log-stream';
import { useApiClient } from '../hooks/use-api';
import { apiLoader, createLoaderApiClient, type LoaderData } from '../utils/loaders';
import { apiAction, type ActionData, createActionApiClient } from '../utils/actions';
import type { IngestionStepId } from '../components/domain/ingestion-progress';

type BulkRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

type BulkRun = Readonly<{
  id: string;
  status: BulkRunStatus;
  startedAt?: string;
  completedAt?: string;
  recordsProcessed?: number;
  bytesProcessed?: number;
  progress?: {
    percentage?: number;
    step?: IngestionStepId;
  };
  stepName?: IngestionStepId;
}>;

type IngestionActionIntent = 'bulk.start' | 'bulk.abort';

type IngestionActionResult =
  | {
      ok: true;
      intent: IngestionActionIntent;
      toast?: { type: 'success' | 'error'; message: string };
    }
  | {
      ok: false;
      error: { code: string; message: string };
    };

export const loader = apiLoader(async (args: LoaderFunctionArgs) => {
  const api = createLoaderApiClient();
  const url = new URL(args.request.url);
  const runId = url.searchParams.get('runId');

  const currentRun = runId
    ? await api.getApi<BulkRun | null>(`/bulk/${encodeURIComponent(runId)}`)
    : await api.getApi<BulkRun | null>('/bulk/current');
  const recentRuns = await api.getApi<{ runs: BulkRun[] }>(`/bulk?limit=5`);

  return { currentRun, runId, recentRuns: recentRuns.runs ?? [] };
});

export const action = apiAction(async (args: ActionFunctionArgs) => {
  const api = createActionApiClient();
  const formData = await args.request.formData();
  const intent = formData.get('intent');

  if (intent !== 'bulk.start' && intent !== 'bulk.abort') {
    return data(
      { ok: false, error: { code: 'missing_intent', message: 'Missing intent' } },
      { status: 400 }
    );
  }

  if (intent === 'bulk.start') {
    await api.postApi('/bulk/start', {
      type: 'export',
      resource: 'products',
    });

    return data({
      ok: true,
      intent,
      toast: { type: 'success', message: 'Bulk ingestion started' },
    } satisfies IngestionActionResult);
  }

  const runId = formData.get('runId');
  if (!runId || typeof runId !== 'string') {
    return data(
      { ok: false, error: { code: 'missing_runId', message: 'Missing runId' } },
      { status: 400 }
    );
  }

  await api.getApi(`/bulk/${encodeURIComponent(runId)}`, { method: 'DELETE' });

  return data({
    ok: true,
    intent,
    toast: { type: 'success', message: 'Bulk ingestion aborted' },
  } satisfies IngestionActionResult);
});

type RouteLoaderData = LoaderData<typeof loader>;
type RouteActionData = ActionData<typeof action>;

export default function IngestionPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentRun: loaderRun, runId, recentRuns } = useLoaderData<RouteLoaderData>();
  const actionFetcher = useFetcher<RouteActionData>();
  const api = useApiClient();
  const [currentRun, setCurrentRun] = useState<BulkRun | null>(loaderRun ?? null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    setCurrentRun(loaderRun ?? null);
  }, [loaderRun]);

  useEffect(() => {
    const result = actionFetcher.data;
    if (!result) return;
    if (result.ok) {
      if ('toast' in result && result.toast?.type === 'success') {
        toast.success(result.toast.message);
      }
    } else {
      toast.error(result.error.message);
    }
  }, [actionFetcher.data]);

  const breadcrumbs = useMemo(
    () => [
      { label: 'Home', href: '/' },
      { label: 'Ingestion', href: location.pathname },
    ],
    [location.pathname]
  );

  const tabs = [
    { label: 'Overview', value: 'overview', to: '/ingestion' },
    { label: 'History', value: 'history', to: '/ingestion/history' },
    { label: 'Schedule', value: 'schedule', to: '/ingestion/schedule' },
  ];

  const isActive = currentRun?.status === 'pending' || currentRun?.status === 'running';
  const isSelectedRun = Boolean(runId && currentRun);
  const currentStep = currentRun?.progress?.step ?? currentRun?.stepName ?? 'download';
  const progress = currentRun?.progress?.percentage ?? 0;

  const logStream = useLogStream({
    endpoint: currentRun ? `/api/bulk/${currentRun.id}/logs/stream` : '',
    enabled: Boolean(currentRun),
    maxEventsPerSecond: 50,
  });

  useEffect(() => {
    if (!currentRun || !isActive) return;
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(() => {
      void api
        .getApi<BulkRun>(`/bulk/${encodeURIComponent(currentRun.id)}`)
        .then((next) => setCurrentRun(next))
        .catch(() => undefined);
    }, 2000);

    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [api, currentRun, isActive]);

  const startIngestion = () => {
    const formData = new FormData();
    formData.set('intent', 'bulk.start');
    void actionFetcher.submit(formData, { method: 'post' });
  };

  const abortIngestion = () => {
    if (!currentRun) return;
    const formData = new FormData();
    formData.set('intent', 'bulk.abort');
    formData.set('runId', currentRun.id);
    void actionFetcher.submit(formData, { method: 'post' });
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={breadcrumbs} />

      <Tabs
        items={tabs.map((tab) => ({ label: tab.label, value: tab.value }))}
        value="overview"
        onValueChange={(v) => {
          const target = tabs.find((t) => t.value === v)?.to ?? '/ingestion';
          void navigate(target);
        }}
      />

      <header className="flex flex-col gap-2">
        <h1 className="text-h2">Bulk Ingestion</h1>
        <p className="text-body text-muted">Monitor and manage data synchronization with Shopify</p>
      </header>

      {isActive && currentRun ? (
        <PolarisCard className="p-4">
          <div className="space-y-6">
            <IngestionProgress
              currentStep={currentStep}
              progress={Math.round(progress)}
              status="running"
              onAbort={abortIngestion}
              abortDisabled={actionFetcher.state !== 'idle'}
            />

            <LogConsole
              logs={logStream.logs}
              connected={logStream.connected}
              error={logStream.error}
              paused={logStream.paused}
              onPause={logStream.pause}
              onResume={logStream.resume}
              onClear={logStream.clear}
            />
          </div>
        </PolarisCard>
      ) : isSelectedRun && currentRun ? (
        <PolarisCard className="p-4">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-h3">Run {currentRun.id}</div>
                <div className="text-caption text-muted">Status: {currentRun.status}</div>
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  void navigate('/ingestion');
                }}
              >
                Clear selection
              </Button>
            </div>
            <LogConsole
              logs={logStream.logs}
              connected={logStream.connected}
              error={logStream.error}
              paused={logStream.paused}
              onPause={logStream.pause}
              onResume={logStream.resume}
              onClear={logStream.clear}
            />
          </div>
        </PolarisCard>
      ) : (
        <PolarisCard className="p-6">
          <div className="grid gap-6 lg:grid-cols-[2fr,3fr]">
            <div className="space-y-3">
              <h2 className="text-h3">Start a full sync</h2>
              <p className="text-body text-muted">
                Kick off a full Shopify catalog ingestion. You can monitor progress and logs in real
                time once the run starts.
              </p>
              {recentRuns.length > 0 ? (
                <div className="text-caption text-muted">
                  Last run: {recentRuns[0]?.completedAt ?? recentRuns[0]?.startedAt ?? '—'}
                </div>
              ) : null}
              <Button
                variant="primary"
                onClick={startIngestion}
                loading={actionFetcher.state !== 'idle'}
              >
                Start Full Sync
              </Button>
            </div>
            <div className="rounded-md border bg-muted/10 p-4">
              <FileUpload
                label="Manual JSONL upload"
                description="Upload a JSONL file to ingest without a Shopify bulk run."
                accept={{ 'application/jsonl': ['.jsonl'], 'application/json': ['.json'] }}
                maxFiles={1}
                maxSize={1024 * 1024 * 1024}
              />
            </div>
          </div>
        </PolarisCard>
      )}
    </div>
  );
}
