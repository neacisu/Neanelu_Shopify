import type { ActionFunction, ActionFunctionArgs, LoaderFunctionArgs } from 'react-router-dom';
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
import { apiAction, createActionApiClient } from '../utils/actions';
import type {
  IngestionStageMetric,
  IngestionStepId,
} from '../components/domain/ingestion-progress';

type BulkRunStatus =
  | 'pending'
  | 'running'
  | 'polling'
  | 'downloading'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

type BulkRun = Readonly<{
  id: string;
  status: BulkRunStatus;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  recordsProcessed?: number;
  bytesProcessed?: number | null;
  resultSizeBytes?: number | null;
  shopifyStatus?: ShopifyBulkOperationStatus | null;
  shopifyErrorCode?: string | null;
  shopifyObjectCount?: number | null;
  shopifyRootObjectCount?: number | null;
  shopifyFileSizeBytes?: number | null;
  shopifyUpdatedAt?: string | null;
  checkpoint?: {
    committedLines?: number | null;
    committedRecords?: number | null;
    committedBytes?: number | null;
    lastCommitAt?: string | null;
  };
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
  rootObjectCount?: string | null;
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

type IngestionActionResponse = ReturnType<typeof data<IngestionActionResult>>;

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
  const completedRuns = await api.getApi<{ runs: BulkRun[] }>(`/bulk?limit=5&status=completed`);
  const recentRuns = await api.getApi<{ runs: BulkRun[] }>(`/bulk?limit=5`);

  return {
    currentRun,
    runId,
    recentRuns: recentRuns.runs ?? [],
    completedRuns: completedRuns.runs ?? [],
    activeShopifyOperation: activeShopifyOperation.operation ?? null,
  };
});

export const action: ActionFunction = apiAction(
  async (args: ActionFunctionArgs): Promise<IngestionActionResponse> => {
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
  }
);

type RouteLoaderData = LoaderData<typeof loader>;
type RouteActionData = IngestionActionResult;

export default function IngestionPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    currentRun: loaderRun,
    runId,
    recentRuns,
    completedRuns,
    activeShopifyOperation,
  } = useLoaderData<RouteLoaderData>();
  const actionFetcher = useFetcher<RouteActionData>();
  const api = useApiClient();
  const [currentRun, setCurrentRun] = useState<BulkRun | null>(loaderRun ?? null);
  const [shopifyOperation, setShopifyOperation] = useState<ShopifyBulkOperation | null>(
    activeShopifyOperation ?? null
  );
  const [showRawLogs, setShowRawLogs] = useState(false);
  const [rateMetrics, setRateMetrics] = useState<{
    bytesPerSec?: number | null;
    linesPerSec?: number | null;
    recordsPerSec?: number | null;
  }>({});
  const [shopifyRateMetrics, setShopifyRateMetrics] = useState<{
    productsPerSec?: number | null;
    objectsPerSec?: number | null;
  }>({});
  const pollRef = useRef<number | null>(null);
  const shopifyPollRef = useRef<number | null>(null);
  const rateSampleRef = useRef<{
    at: number;
    bytes?: number | null;
    lines?: number | null;
    records?: number | null;
  } | null>(null);
  const shopifyRateSampleRef = useRef<{
    at: number;
    products?: number | null;
    objects?: number | null;
  } | null>(null);

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
    rateSampleRef.current = null;
    setRateMetrics({});
  }, [currentRun?.id]);

  useEffect(() => {
    shopifyRateSampleRef.current = null;
    setShopifyRateMetrics({});
  }, [currentRun?.id, shopifyOperation?.id]);

  useEffect(() => {
    if (!currentRun) return;
    const now = Date.now();
    const bytes =
      typeof currentRun.bytesProcessed === 'number'
        ? currentRun.bytesProcessed
        : typeof currentRun.checkpoint?.committedBytes === 'number'
          ? currentRun.checkpoint.committedBytes
          : null;
    const lines =
      typeof currentRun.checkpoint?.committedLines === 'number'
        ? currentRun.checkpoint.committedLines
        : null;
    const records =
      typeof currentRun.checkpoint?.committedRecords === 'number'
        ? currentRun.checkpoint.committedRecords
        : null;

    const prev = rateSampleRef.current;
    if (prev && now > prev.at) {
      const deltaSeconds = (now - prev.at) / 1000;
      const calcRate = (currentValue: number | null, prevValue: number | null) =>
        currentValue !== null && prevValue !== null
          ? (currentValue - prevValue) / deltaSeconds
          : null;

      const bytesRate = calcRate(bytes, prev.bytes ?? null);
      const linesRate = calcRate(lines, prev.lines ?? null);
      const recordsRate = calcRate(records, prev.records ?? null);

      setRateMetrics({
        bytesPerSec: bytesRate !== null && bytesRate > 0 ? bytesRate : null,
        linesPerSec: linesRate !== null && linesRate > 0 ? linesRate : null,
        recordsPerSec: recordsRate !== null && recordsRate > 0 ? recordsRate : null,
      });
    }

    rateSampleRef.current = {
      at: now,
      bytes,
      lines,
      records,
    };
  }, [
    currentRun?.bytesProcessed,
    currentRun?.checkpoint?.committedBytes,
    currentRun?.checkpoint?.committedLines,
    currentRun?.checkpoint?.committedRecords,
    currentRun?.id,
  ]);

  useEffect(() => {
    const result = actionFetcher.data;
    if (!result) return;
    if (result.ok !== true) {
      const error = (result as { error?: { message?: string } }).error;
      toast.error(error?.message ?? 'Request failed');
      return;
    }

    const okResult = result;

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

  const isActive =
    currentRun?.status === 'pending' ||
    currentRun?.status === 'running' ||
    currentRun?.status === 'polling' ||
    currentRun?.status === 'downloading' ||
    currentRun?.status === 'processing';
  const isSelectedRun = Boolean(runId && currentRun);
  const currentStep = currentRun?.progress?.step ?? currentRun?.stepName ?? 'download';
  const progress = currentRun?.progress?.percentage ?? 0;
  const shopifyStatus = currentRun?.shopifyStatus ?? shopifyOperation?.status ?? null;
  const isShopifyRunning =
    shopifyStatus === 'CREATED' || shopifyStatus === 'RUNNING' || shopifyStatus === 'CANCELING';
  const hasShopifyOperation = Boolean(shopifyOperation?.id);
  const showShopifyStatusCard = isActive || hasShopifyOperation;
  const shopifyErrorCode = currentRun?.shopifyErrorCode ?? shopifyOperation?.errorCode ?? null;

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
    endpoint: currentRun ? `/api/bulk/${currentRun.id}/logs/ws` : '',
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

  const formatCount = (value?: string | number | null) => {
    const count = typeof value === 'number' ? value : value ? Number(value) : Number.NaN;
    if (!Number.isFinite(count)) return null;
    return new Intl.NumberFormat('en-GB').format(count);
  };

  const formatNumber = (value?: number | null) => {
    const count = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(count)) return null;
    return new Intl.NumberFormat('en-GB').format(count);
  };

  const formatMegabytes = (value?: string | number | null) => {
    const bytes = typeof value === 'number' ? value : value ? Number(value) : Number.NaN;
    if (!Number.isFinite(bytes)) return null;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(mb >= 10 ? 0 : 1)} Mb`;
  };

  const parseNumber = (value?: string | number | null) => {
    const parsed = typeof value === 'number' ? value : value ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
  };

  const formatBytes = (value?: number | null) => {
    const bytes = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(bytes)) return null;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let normalized = bytes;
    let unitIndex = 0;
    while (normalized >= 1024 && unitIndex < units.length - 1) {
      normalized /= 1024;
      unitIndex += 1;
    }
    const digits = normalized >= 10 || unitIndex === 0 ? 0 : 1;
    return `${normalized.toFixed(digits)} ${units[unitIndex]}`;
  };

  const formatBytesRate = (value?: number | null) => {
    const formatted = formatBytes(value);
    return formatted ? `${formatted}/s` : null;
  };

  const formatCountRate = (value?: number | null, unitLabel = 'records') => {
    const rate = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(rate) || rate <= 0) return null;
    const digits = rate >= 100 ? 0 : rate >= 10 ? 1 : 2;
    return `${rate.toFixed(digits)} ${unitLabel}/s`;
  };

  const formatDuration = (seconds?: number | null) => {
    const raw = typeof seconds === 'number' ? seconds : Number.NaN;
    if (!Number.isFinite(raw)) return null;
    const totalSeconds = Math.max(0, Math.round(raw));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

  const parseIsoDate = (value?: string | null) => {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const computeWeightedRate = (
    recentRate: number | null | undefined,
    processed: number | null | undefined,
    startedAtMs: number | null
  ) => {
    const safeProcessed = typeof processed === 'number' && processed > 0 ? processed : null;
    const safeStartedAt = typeof startedAtMs === 'number' ? startedAtMs : null;
    const elapsedSeconds =
      safeStartedAt != null ? Math.max(1, (Date.now() - safeStartedAt) / 1000) : null;
    const avgRate =
      safeProcessed != null && elapsedSeconds != null ? safeProcessed / elapsedSeconds : null;

    if (typeof recentRate === 'number' && recentRate > 0 && avgRate != null && avgRate > 0) {
      return recentRate * 0.7 + avgRate * 0.3;
    }

    if (typeof recentRate === 'number' && recentRate > 0) return recentRate;
    if (avgRate != null && avgRate > 0) return avgRate;
    return null;
  };

  const shopifyObjectCount =
    typeof currentRun?.shopifyObjectCount === 'number'
      ? currentRun.shopifyObjectCount
      : typeof shopifyOperation?.objectCount === 'string'
        ? Number(shopifyOperation.objectCount)
        : null;
  const shopifyRootObjectCount =
    typeof currentRun?.shopifyRootObjectCount === 'number'
      ? currentRun.shopifyRootObjectCount
      : typeof shopifyOperation?.rootObjectCount === 'string'
        ? Number(shopifyOperation.rootObjectCount)
        : null;
  const objectCountLabel = formatCount(shopifyObjectCount);
  const rootObjectCountLabel = formatCount(shopifyRootObjectCount);
  const lastCompletedRun = completedRuns[0] ?? null;
  const expectedProducts =
    typeof lastCompletedRun?.shopifyRootObjectCount === 'number'
      ? lastCompletedRun.shopifyRootObjectCount
      : typeof lastCompletedRun?.recordsProcessed === 'number'
        ? lastCompletedRun.recordsProcessed
        : null;
  const expectedProductsLabel = formatCount(expectedProducts);
  const fileSizeLabel = formatMegabytes(
    typeof currentRun?.shopifyFileSizeBytes === 'number'
      ? currentRun.shopifyFileSizeBytes
      : shopifyOperation?.fileSize
  );
  const bytesProcessed =
    typeof currentRun?.bytesProcessed === 'number'
      ? currentRun.bytesProcessed
      : typeof currentRun?.checkpoint?.committedBytes === 'number'
        ? currentRun.checkpoint.committedBytes
        : null;
  const totalBytes =
    typeof currentRun?.resultSizeBytes === 'number'
      ? currentRun.resultSizeBytes
      : typeof currentRun?.shopifyFileSizeBytes === 'number'
        ? currentRun.shopifyFileSizeBytes
        : parseNumber(shopifyOperation?.fileSize ?? null);
  const totalRecords = shopifyObjectCount;
  const linesProcessed =
    typeof currentRun?.checkpoint?.committedLines === 'number'
      ? currentRun.checkpoint.committedLines
      : null;
  const recordsProcessed =
    typeof currentRun?.checkpoint?.committedRecords === 'number'
      ? currentRun.checkpoint.committedRecords
      : null;
  const startedAtMs = parseIsoDate(currentRun?.startedAt ?? currentRun?.createdAt ?? null);
  const shopifyStartedAtMs = parseIsoDate(
    currentRun?.startedAt ?? currentRun?.createdAt ?? shopifyOperation?.createdAt ?? null
  );
  const downloadRate = computeWeightedRate(rateMetrics.bytesPerSec, bytesProcessed, startedAtMs);
  const parseRate = computeWeightedRate(rateMetrics.linesPerSec, linesProcessed, startedAtMs);
  const ingestRate = computeWeightedRate(rateMetrics.recordsPerSec, recordsProcessed, startedAtMs);
  const shopifyProductsRate = computeWeightedRate(
    shopifyRateMetrics.productsPerSec,
    shopifyRootObjectCount,
    shopifyStartedAtMs
  );
  const shopifyObjectsRate = computeWeightedRate(
    shopifyRateMetrics.objectsPerSec,
    shopifyObjectCount,
    shopifyStartedAtMs
  );
  const downloadBytesLabel = formatBytes(bytesProcessed);
  const downloadTotalLabel = formatBytes(totalBytes);
  const downloadProgressPct =
    typeof bytesProcessed === 'number' && typeof totalBytes === 'number' && totalBytes > 0
      ? Math.min(100, Math.round((bytesProcessed / totalBytes) * 100))
      : null;
  const finalShopifyMessage =
    !isShopifyRunning && shopifyStatus
      ? shopifyErrorCode
        ? `Shopify error: ${shopifyErrorCode}`
        : shopifyStatus === 'COMPLETED'
          ? 'Shopify finished the bulk export.'
          : `Shopify finished with status ${shopifyStatus}.`
      : null;

  const downloadProgress =
    typeof bytesProcessed === 'number' && typeof totalBytes === 'number' && totalBytes > 0
      ? (bytesProcessed / totalBytes) * 100
      : null;
  const parseProgress =
    typeof linesProcessed === 'number' && typeof totalRecords === 'number' && totalRecords > 0
      ? (linesProcessed / totalRecords) * 100
      : null;
  const ingestProgress =
    typeof recordsProcessed === 'number' && typeof totalRecords === 'number' && totalRecords > 0
      ? (recordsProcessed / totalRecords) * 100
      : null;

  const normalizedExpectedProducts =
    typeof expectedProducts === 'number' &&
    typeof shopifyRootObjectCount === 'number' &&
    shopifyRootObjectCount > expectedProducts
      ? shopifyRootObjectCount
      : expectedProducts;
  const overallProgress =
    typeof shopifyRootObjectCount === 'number' &&
    typeof normalizedExpectedProducts === 'number' &&
    normalizedExpectedProducts > 0
      ? Math.min(100, (shopifyRootObjectCount / normalizedExpectedProducts) * 100)
      : null;
  const overallEta =
    typeof shopifyProductsRate === 'number' &&
    shopifyProductsRate > 0 &&
    typeof normalizedExpectedProducts === 'number' &&
    typeof shopifyRootObjectCount === 'number'
      ? Math.max(0, (normalizedExpectedProducts - shopifyRootObjectCount) / shopifyProductsRate)
      : null;
  const overallSpeedLabelRaw = [
    formatCountRate(shopifyProductsRate, 'products'),
    formatCountRate(shopifyObjectsRate, 'objects'),
  ]
    .filter(Boolean)
    .join(' · ');
  const overallSpeedLabel = overallSpeedLabelRaw.length > 0 ? overallSpeedLabelRaw : null;
  const overallProcessedLabel =
    rootObjectCountLabel && isShopifyRunning ? `${rootObjectCountLabel} products` : null;
  const overallTotalLabel =
    expectedProductsLabel && isShopifyRunning ? `${expectedProductsLabel} expected` : null;
  const overallEtaLabel = isShopifyRunning ? formatDuration(overallEta) : null;
  const overallProgressPct =
    isShopifyRunning && typeof overallProgress === 'number' ? overallProgress : progress;

  const downloadEta =
    typeof downloadRate === 'number' &&
    downloadRate > 0 &&
    typeof totalBytes === 'number' &&
    typeof bytesProcessed === 'number'
      ? Math.max(0, (totalBytes - bytesProcessed) / downloadRate)
      : null;
  const parseEta =
    typeof parseRate === 'number' &&
    parseRate > 0 &&
    typeof totalRecords === 'number' &&
    typeof linesProcessed === 'number'
      ? Math.max(0, (totalRecords - linesProcessed) / parseRate)
      : null;
  const ingestEta =
    typeof ingestRate === 'number' &&
    ingestRate > 0 &&
    typeof totalRecords === 'number' &&
    typeof recordsProcessed === 'number'
      ? Math.max(0, (totalRecords - recordsProcessed) / ingestRate)
      : null;

  const stageDetails: IngestionStageMetric[] = [
    {
      id: 'download',
      label: 'Download',
      progress: downloadProgress,
      processedLabel: formatBytes(bytesProcessed),
      totalLabel: formatBytes(totalBytes),
      speedLabel: formatBytesRate(downloadRate),
      etaLabel: formatDuration(downloadEta),
    },
    {
      id: 'parse',
      label: 'Parse',
      progress: parseProgress,
      processedLabel: formatNumber(linesProcessed),
      totalLabel: formatNumber(totalRecords),
      speedLabel: formatCountRate(parseRate, 'lines'),
      etaLabel: formatDuration(parseEta),
    },
    {
      id: 'ingest',
      label: 'Ingest',
      progress: ingestProgress,
      processedLabel: formatNumber(recordsProcessed),
      totalLabel: formatNumber(totalRecords),
      speedLabel: formatCountRate(ingestRate, 'records'),
      etaLabel: formatDuration(ingestEta),
    },
  ];

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
              {Boolean(objectCountLabel ?? rootObjectCountLabel ?? fileSizeLabel) && (
                <div className="text-caption text-muted">
                  {rootObjectCountLabel ? `Products: ${rootObjectCountLabel}` : null}
                  {rootObjectCountLabel && objectCountLabel ? ' · ' : null}
                  {objectCountLabel ? `Objects: ${objectCountLabel}` : null}
                  {(rootObjectCountLabel || objectCountLabel) && fileSizeLabel ? ' · ' : null}
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
              {Boolean(rootObjectCountLabel ?? objectCountLabel ?? fileSizeLabel) && (
                <span>
                  {rootObjectCountLabel ? `Processed ${rootObjectCountLabel} products` : null}
                  {rootObjectCountLabel && objectCountLabel ? ' · ' : null}
                  {objectCountLabel ? `Objects ${objectCountLabel}` : null}
                  {(rootObjectCountLabel || objectCountLabel) && fileSizeLabel ? ' · ' : null}
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
              progress={Math.round(overallProgressPct)}
              status="running"
              onAbort={abortIngestion}
              abortDisabled={actionFetcher.state !== 'idle'}
              overallLabel={isShopifyRunning ? 'Overall progress (Shopify)' : 'Overall progress'}
              overallProcessedLabel={overallProcessedLabel}
              overallTotalLabel={overallTotalLabel}
              overallSpeedLabel={overallSpeedLabel}
              overallEtaLabel={overallEtaLabel}
              stageDetails={stageDetails}
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
                transport="websocket"
                maxEventsPerSecond={50}
                bufferSize={1000}
                {...(currentRun ? { endpoint: `/api/bulk/${currentRun.id}/logs/ws` } : {})}
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
              transport="websocket"
              maxEventsPerSecond={50}
              bufferSize={1000}
              {...(currentRun ? { endpoint: `/api/bulk/${currentRun.id}/logs/ws` } : {})}
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
