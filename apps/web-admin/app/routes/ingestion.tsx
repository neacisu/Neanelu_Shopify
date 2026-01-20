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
  bytesProcessed?: number | null;
  resultSizeBytes?: number | null;
  progress?: {
    percentage?: number;
    step?: IngestionStepId;
  };
  stepName?: IngestionStepId;
}>;

type ShopifyBulkOperationStatus =
  | 'CREATED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED'
  | 'CANCELING'
  | 'EXPIRED';

type ShopifyBulkOperation = Readonly<{
  id?: string | null;
  status?: ShopifyBulkOperationStatus | null;
  errorCode?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
  objectCount?: string | null;
  fileSize?: string | null;
  url?: string | null;
  partialDataUrl?: string | null;
}>;

type IngestionActionIntent = 'bulk.start' | 'bulk.abort' | 'bulk.cancel-shopify';

type IngestionActionResult =
  | {
      ok: true;
      intent: IngestionActionIntent;
      runId?: string | null;
      status?: BulkRunStatus | null;
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
  const activeShopifyOperation = await api.getApi<{ operation: ShopifyBulkOperation | null }>(
    '/bulk/active-shopify'
  );
  const recentRuns = await api.getApi<{ runs: BulkRun[] }>(`/bulk?limit=5`);

  return {
    currentRun,
    runId,
    recentRuns: recentRuns.runs ?? [],
    activeShopifyOperation: activeShopifyOperation.operation ?? null,
  };
});

export const action = apiAction(async (args: ActionFunctionArgs) => {
  const api = createActionApiClient();
  const formData = await args.request.formData();
  const intent = formData.get('intent');

  if (intent !== 'bulk.start' && intent !== 'bulk.abort' && intent !== 'bulk.cancel-shopify') {
    return data(
      { ok: false, error: { code: 'missing_intent', message: 'Missing intent' } },
      { status: 400 }
    );
  }

  if (intent === 'bulk.start') {
    const startResult = await api.postApi<
      { run_id?: string | null; status?: string | null },
      Record<string, unknown>
    >('/bulk/start', {
      type: 'export',
      resource: 'products',
    });

    const runId = startResult.run_id ?? null;
    const status = (startResult.status ?? null) as BulkRunStatus | null;

    return data({
      ok: true,
      intent,
      runId,
      status,
      toast: { type: 'success', message: 'Bulk ingestion started' },
    } satisfies IngestionActionResult);
  }

  if (intent === 'bulk.cancel-shopify') {
    await api.postApi<{ cancelled: boolean }, Record<string, never>>(
      '/bulk/active-shopify/cancel',
      {}
    );

    return data({
      ok: true,
      intent,
      toast: { type: 'success', message: 'Shopify bulk operation cancel requested' },
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
  const {
    currentRun: loaderRun,
    runId,
    recentRuns,
    activeShopifyOperation,
  } = useLoaderData<RouteLoaderData>();
  const actionFetcher = useFetcher<RouteActionData>();
  const api = useApiClient();
  const [currentRun, setCurrentRun] = useState<BulkRun | null>(loaderRun ?? null);
  const [shopifyOperation, setShopifyOperation] = useState<ShopifyBulkOperation | null>(
    activeShopifyOperation ?? null
  );
  const [showRawLogs, setShowRawLogs] = useState(false);
  const pollRef = useRef<number | null>(null);
  const shopifyPollRef = useRef<number | null>(null);

  useEffect(() => {
    setCurrentRun(loaderRun ?? null);
  }, [loaderRun]);

  useEffect(() => {
    setShowRawLogs(false);
  }, [currentRun?.id]);

  useEffect(() => {
    setShopifyOperation(activeShopifyOperation ?? null);
  }, [activeShopifyOperation]);

  useEffect(() => {
    const result = actionFetcher.data;
    if (!result) return;
    if (result.ok !== true) {
      const error = (result as { error?: { message?: string } }).error;
      toast.error(error?.message ?? 'Request failed');
      return;
    }

    const okResult = result as Extract<IngestionActionResult, { ok: true }>;

    if ('toast' in okResult && okResult.toast?.type === 'success') {
      toast.success(okResult.toast.message);
    }

    if (okResult.intent === 'bulk.start') {
      const selectRun = (run: BulkRun | null) => {
        if (!run) return;
        setCurrentRun(run);
        void navigate(`/ingestion?runId=${encodeURIComponent(run.id)}`);
      };

      if (okResult.runId) {
        selectRun({
          id: okResult.runId,
          status: okResult.status ?? 'pending',
        });
        return;
      }

      void api
        .getApi<BulkRun | null>('/bulk/current')
        .then((run) => {
          if (run) {
            selectRun(run);
            return;
          }
          return api.getApi<{ runs: BulkRun[] }>('/bulk?limit=1').then((resp) => {
            const fallbackRun = resp.runs?.[0] ?? null;
            selectRun(fallbackRun ?? null);
          });
        })
        .catch(() => undefined);
    }
  }, [actionFetcher.data, api, navigate]);

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
  const shopifyStatus = shopifyOperation?.status ?? null;
  const isShopifyRunning =
    shopifyStatus === 'CREATED' || shopifyStatus === 'RUNNING' || shopifyStatus === 'CANCELING';
  const hasShopifyOperation = Boolean(shopifyOperation?.id);
  const showShopifyStatusCard = isActive || hasShopifyOperation;

  useEffect(() => {
    if (!isActive && !hasShopifyOperation) return;
    if (shopifyPollRef.current) window.clearInterval(shopifyPollRef.current);
    shopifyPollRef.current = window.setInterval(() => {
      void api
        .getApi<{ operation: ShopifyBulkOperation | null }>('/bulk/active-shopify')
        .then((res) => setShopifyOperation(res.operation ?? null))
        .catch(() => undefined);
    }, 5000);

    return () => {
      if (shopifyPollRef.current) window.clearInterval(shopifyPollRef.current);
      shopifyPollRef.current = null;
    };
  }, [api, hasShopifyOperation, isActive]);

  const logStream = useLogStream({
    endpoint: currentRun ? `/api/bulk/${currentRun.id}/logs/stream` : '',
    enabled: Boolean(currentRun && isActive),
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

  const uploadJsonl = async (
    file: File,
    apiUpload: {
      setProgress: (progress: number) => void;
      setError: (message: string) => void;
      setDone: () => void;
    }
  ) => {
    try {
      apiUpload.setProgress(5);
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.postApi<{ run_id?: string | null; status?: string | null }, FormData>(
        '/bulk/upload',
        formData
      );
      apiUpload.setProgress(100);
      apiUpload.setDone();
      if (res?.run_id) {
        setCurrentRun({
          id: res.run_id,
          status: (res.status ?? 'running') as BulkRunStatus,
        });
        void navigate(`/ingestion?runId=${encodeURIComponent(res.run_id)}`);
      }
      toast.success('Upload queued for ingestion');
    } catch (err) {
      apiUpload.setError(err instanceof Error ? err.message : 'Upload failed');
      toast.error('Upload failed');
    }
  };

  const abortIngestion = () => {
    if (!currentRun) return;
    const formData = new FormData();
    formData.set('intent', 'bulk.abort');
    formData.set('runId', currentRun.id);
    void actionFetcher.submit(formData, { method: 'post' });
  };

  const cancelShopifyOperation = () => {
    const formData = new FormData();
    formData.set('intent', 'bulk.cancel-shopify');
    void actionFetcher.submit(formData, { method: 'post' });
  };

  const showLogConsole = !isActive || showRawLogs;

  const formatCount = (value?: string | null) => {
    const count = value ? Number(value) : Number.NaN;
    if (!Number.isFinite(count)) return null;
    return new Intl.NumberFormat('en-GB').format(count);
  };

  const formatMegabytes = (value?: string | null) => {
    const bytes = value ? Number(value) : Number.NaN;
    if (!Number.isFinite(bytes)) return null;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(mb >= 10 ? 0 : 1)} Mb`;
  };

  const formatBytesToMb = (value?: number | null) => {
    const bytes = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(bytes)) return null;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(mb >= 10 ? 0 : 1)} Mb`;
  };

  const objectCountLabel = formatCount(shopifyOperation?.objectCount);
  const fileSizeLabel = formatMegabytes(shopifyOperation?.fileSize);
  const downloadBytesLabel = formatBytesToMb(currentRun?.bytesProcessed ?? null);
  const downloadTotalLabel = formatBytesToMb(currentRun?.resultSizeBytes ?? null);
  const downloadProgressPct =
    typeof currentRun?.bytesProcessed === 'number' &&
    typeof currentRun?.resultSizeBytes === 'number' &&
    currentRun.resultSizeBytes > 0
      ? Math.min(100, Math.round((currentRun.bytesProcessed / currentRun.resultSizeBytes) * 100))
      : null;
  const finalShopifyMessage =
    !isShopifyRunning && shopifyStatus
      ? shopifyOperation?.errorCode
        ? `Shopify error: ${shopifyOperation.errorCode}`
        : shopifyStatus === 'COMPLETED'
          ? 'Shopify finished the bulk export.'
          : `Shopify finished with status ${shopifyStatus}.`
      : null;

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

      {showShopifyStatusCard && (
        <PolarisCard className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-h3">
                {isShopifyRunning || isActive
                  ? 'Shopify sync in progress'
                  : 'Shopify sync finished'}
              </div>
              <div className="text-caption text-muted">
                Status: {shopifyStatus ?? 'waiting for Shopify response'}
                {shopifyOperation?.id ? ` · ${shopifyOperation.id}` : ''}
                {shopifyStatus === 'CANCELING' ? ' · Canceling…' : ''}
              </div>
              {Boolean(objectCountLabel ?? fileSizeLabel) && (
                <div className="text-caption text-muted">
                  {objectCountLabel ? `Objects: ${objectCountLabel}` : null}
                  {objectCountLabel && fileSizeLabel ? ' · ' : null}
                  {fileSizeLabel ? `File size: ${fileSizeLabel}` : null}
                </div>
              )}
              {finalShopifyMessage ? (
                <div className="text-caption text-muted">{finalShopifyMessage}</div>
              ) : null}
              {shopifyStatus === 'COMPLETED' && shopifyOperation?.url ? (
                <div className="text-caption">
                  <a
                    className="text-blue-600 underline"
                    href={shopifyOperation.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download bulk file
                  </a>
                </div>
              ) : null}
              {shopifyStatus === 'COMPLETED' && shopifyOperation?.partialDataUrl ? (
                <div className="text-caption">
                  <a
                    className="text-blue-600 underline"
                    href={shopifyOperation.partialDataUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download partial data
                  </a>
                </div>
              ) : null}
            </div>
            {isShopifyRunning ? (
              <Button
                variant="destructive"
                onClick={cancelShopifyOperation}
                disabled={actionFetcher.state !== 'idle' || shopifyStatus === 'CANCELING'}
              >
                Cancel Shopify sync
              </Button>
            ) : null}
          </div>
          {(isShopifyRunning || isActive) && (
            <div className="mt-4 flex items-center gap-3 text-caption text-muted">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Shopify is still processing the bulk export. We will update automatically.
              {Boolean(objectCountLabel ?? fileSizeLabel) && (
                <span>
                  {objectCountLabel ? `Processed ${objectCountLabel} products` : null}
                  {objectCountLabel && fileSizeLabel ? ' · ' : null}
                  {fileSizeLabel ? `File size ${fileSizeLabel}` : null}
                </span>
              )}
            </div>
          )}
        </PolarisCard>
      )}

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

            {downloadBytesLabel && downloadTotalLabel ? (
              <div className="text-caption text-muted">
                Downloaded {downloadBytesLabel} of {downloadTotalLabel}
                {typeof downloadProgressPct === 'number' ? ` · ${downloadProgressPct}%` : ''}
              </div>
            ) : null}

            {isActive && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowRawLogs((prev) => !prev)}
                >
                  {showRawLogs ? 'Hide raw logs' : 'Show raw logs'}
                </Button>
              </div>
            )}
            {showLogConsole ? (
              <LogConsole
                logs={logStream.logs}
                connected={logStream.connected}
                error={logStream.error}
                {...(isActive ? {} : { statusLabel: 'Historical', statusTone: 'warning' })}
                paused={logStream.paused}
                onPause={logStream.pause}
                onResume={logStream.resume}
                onClear={logStream.clear}
                transport="sse"
                maxEventsPerSecond={50}
                bufferSize={1000}
                {...(currentRun ? { endpoint: `/api/bulk/${currentRun.id}/logs/stream` } : {})}
              />
            ) : (
              <div className="rounded-md border border-dashed p-4 text-caption text-muted">
                Raw logs are hidden while the sync is running to avoid noise.
              </div>
            )}
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
              <div className="flex flex-wrap gap-2">
                {(currentRun.status === 'pending' || currentRun.status === 'running') && (
                  <Button
                    variant="destructive"
                    onClick={abortIngestion}
                    disabled={actionFetcher.state !== 'idle'}
                  >
                    Cancel run
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={() => {
                    void navigate('/ingestion');
                  }}
                >
                  Clear selection
                </Button>
              </div>
            </div>
            <LogConsole
              logs={logStream.logs}
              connected={logStream.connected}
              error={logStream.error}
              {...(isActive ? {} : { statusLabel: 'Historical', statusTone: 'warning' })}
              paused={logStream.paused}
              onPause={logStream.pause}
              onResume={logStream.resume}
              onClear={logStream.clear}
              transport="sse"
              maxEventsPerSecond={50}
              bufferSize={1000}
              {...(currentRun ? { endpoint: `/api/bulk/${currentRun.id}/logs/stream` } : {})}
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
                onUpload={uploadJsonl}
              />
            </div>
          </div>
        </PolarisCard>
      )}
    </div>
  );
}
