import type { ActionFunction, ActionFunctionArgs, LoaderFunctionArgs } from 'react-router-dom';
import { data, useFetcher, useLoaderData, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useScrollReveal } from '../hooks/useScrollReveal';

import { Breadcrumbs } from '../components/layout/breadcrumbs';
import { Tabs } from '../components/ui/tabs';
import { Button } from '../components/ui/button';
import { InfoTooltip } from '../components/ui/info-tooltip';
import { FileUpload } from '../components/ui/FileUpload';
import { IngestionProgress, LogConsole } from '../components/domain/index.js';
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
  // Best-effort: Shopify bulk lookup can fail when shop token is missing/needs reauth.
  // The page should still load and show the local ingestion state.
  let activeShopifyOperation: { operation: ShopifyBulkOperation | null } = { operation: null };
  try {
    activeShopifyOperation = await api.getApi<{ operation: ShopifyBulkOperation | null }>(
      '/bulk/active-shopify'
    );
  } catch {
    // ignore; keep operation null
  }
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
        toast: { type: 'success', message: 'Sincronizarea în masă a fost pornită' },
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
        toast: { type: 'success', message: 'Anularea operațiunii Shopify a fost solicitată' },
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
      toast: { type: 'success', message: 'Sincronizarea în masă a fost anulată' },
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

  // După pornirea sync-ului, afișează imediat monitorizarea (fără a aștepta revalidarea loader-ului)
  useEffect(() => {
    const result = actionFetcher.data;
    if (result && 'ok' in result && result.ok && result.intent === 'bulk.start' && result.runId) {
      setCurrentRun({
        id: result.runId,
        status: result.status ?? 'running',
      });
      void navigate(`/ingestion?runId=${encodeURIComponent(result.runId)}`, {
        replace: true,
      });
    }
  }, [actionFetcher.data, navigate]);

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
      toast.error(error?.message ?? 'Cererea a eșuat');
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
      { label: 'Acasă', href: '/' },
      { label: 'Ingestie', href: location.pathname },
    ],
    [location.pathname]
  );

  const tabs = [
    { label: 'Prezentare', value: 'overview', to: '/ingestion' },
    { label: 'Istoric', value: 'history', to: '/ingestion/history' },
    { label: 'Programare', value: 'schedule', to: '/ingestion/schedule' },
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
      toast.success('Fișierul a fost pus la coadă pentru ingestie');
    } catch (err) {
      apiUpload.setError(err instanceof Error ? err.message : 'Încărcarea a eșuat');
      toast.error('Încărcarea a eșuat');
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
    return new Intl.NumberFormat('ro-RO').format(count);
  };

  const formatNumber = (value?: number | null) => {
    const count = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(count)) return null;
    return new Intl.NumberFormat('ro-RO').format(count);
  };

  const formatMegabytes = (value?: string | number | null) => {
    const bytes = typeof value === 'number' ? value : value ? Number(value) : Number.NaN;
    if (!Number.isFinite(bytes)) return null;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(mb >= 10 ? 0 : 1)} Mb`;
  };

  const [contentRef, contentVisible] = useScrollReveal<HTMLDivElement>({
    rootMargin: '0px 0px -40px 0px',
  });

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
        ? `Eroare Shopify: ${shopifyErrorCode}`
        : shopifyStatus === 'COMPLETED'
          ? 'Shopify a finalizat exportul în masă.'
          : `Shopify a finalizat cu status ${shopifyStatus}.`
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
    <div
      ref={contentRef}
      className="space-y-6"
      style={{
        animation: contentVisible ? 'fadeSlideUp 0.4s ease-out both' : 'none',
      }}
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <Breadcrumbs items={breadcrumbs} />
          <h1 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100 motion-safe:animate-[fadeSlideUp_0.5s_ease-out_both]">
            Sincronizare catalog
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Pornește sau monitorizează sincronizarea în masă cu Shopify și încarcă fișiere JSONL
          </p>
        </div>
      </header>

      <span className="inline-flex items-center gap-1.5">
        <Tabs
          items={tabs.map((tab) => ({ label: tab.label, value: tab.value }))}
          value="overview"
          onValueChange={(v) => {
            const target = tabs.find((t) => t.value === v)?.to ?? '/ingestion';
            void navigate(target);
          }}
        />
        <InfoTooltip title="Navigare ingestie" side="bottom">
          Prezentare: pornește sync complet sau încarcă JSONL, monitorizează progresul. Istoric:
          rulări anterioare și status. Programare: configurează sincronizări automate recurente.
        </InfoTooltip>
      </span>

      {showShopifyStatusCard && (
        <article className="overflow-hidden rounded-xl border border-slate-200/90 bg-white/80 backdrop-blur-sm p-4 shadow-[var(--shadow-sm)] dark:border-slate-700/60 dark:bg-slate-900/80">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                {isShopifyRunning || isActive
                  ? 'Sincronizare Shopify în curs'
                  : 'Sincronizare Shopify finalizată'}
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Status: {shopifyStatus ?? 'aștept răspuns Shopify'}
                {shopifyOperation?.id ? ` · ${shopifyOperation.id}` : ''}
                {shopifyStatus === 'CANCELING' ? ' · Se anulează…' : ''}
              </p>
              {Boolean(objectCountLabel ?? rootObjectCountLabel ?? fileSizeLabel) && (
                <p className="mt-0.5 text-sm text-slate-500">
                  {rootObjectCountLabel ? `Produse: ${rootObjectCountLabel}` : null}
                  {rootObjectCountLabel && objectCountLabel ? ' · ' : null}
                  {objectCountLabel ? `Obiecte: ${objectCountLabel}` : null}
                  {(rootObjectCountLabel || objectCountLabel) && fileSizeLabel ? ' · ' : null}
                  {fileSizeLabel ? `Dimensiune fișier: ${fileSizeLabel}` : null}
                </p>
              )}
              {finalShopifyMessage ? (
                <p className="mt-0.5 text-sm text-slate-500">{finalShopifyMessage}</p>
              ) : null}
              {shopifyStatus === 'COMPLETED' && shopifyOperation?.url ? (
                <p className="mt-1 text-sm">
                  <a
                    className="text-blue-600 underline hover:text-blue-700"
                    href={shopifyOperation.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Descarcă fișierul bulk
                  </a>
                </p>
              ) : null}
              {shopifyStatus === 'COMPLETED' && shopifyOperation?.partialDataUrl ? (
                <p className="mt-1 text-sm">
                  <a
                    className="text-blue-600 underline hover:text-blue-700"
                    href={shopifyOperation.partialDataUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Descarcă date parțiale
                  </a>
                </p>
              ) : null}
            </div>
            {isShopifyRunning ? (
              <Button
                variant="destructive"
                onClick={cancelShopifyOperation}
                disabled={actionFetcher.state !== 'idle' || shopifyStatus === 'CANCELING'}
                className="transition-all duration-200 hover:shadow-[var(--shadow-sm)]"
              >
                Anulează sync Shopify
              </Button>
            ) : null}
          </div>
          {(isShopifyRunning || isActive) && (
            <div className="mt-4 flex items-center gap-3 text-sm text-slate-500">
              <span
                className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"
                aria-hidden
              />
              Shopify procesează exportul în masă. Actualizarea este automată.
              {Boolean(rootObjectCountLabel ?? objectCountLabel ?? fileSizeLabel) && (
                <span>
                  {rootObjectCountLabel ? `Procesate ${rootObjectCountLabel} produse` : null}
                  {rootObjectCountLabel && objectCountLabel ? ' · ' : null}
                  {objectCountLabel ? `Obiecte ${objectCountLabel}` : null}
                  {(rootObjectCountLabel || objectCountLabel) && fileSizeLabel ? ' · ' : null}
                  {fileSizeLabel ? `Dimensiune ${fileSizeLabel}` : null}
                </span>
              )}
            </div>
          )}
        </article>
      )}

      {isActive && currentRun ? (
        <article className="overflow-hidden rounded-xl border border-slate-200/90 bg-white/80 backdrop-blur-sm p-4 shadow-[var(--shadow-sm)] dark:border-slate-700/60 dark:bg-slate-900/80">
          <div className="space-y-6">
            <IngestionProgress
              currentStep={currentStep}
              progress={Math.round(overallProgressPct)}
              status="running"
              onAbort={abortIngestion}
              abortDisabled={actionFetcher.state !== 'idle'}
              overallLabel={isShopifyRunning ? 'Progres general (Shopify)' : 'Progres general'}
              overallProcessedLabel={overallProcessedLabel}
              overallTotalLabel={overallTotalLabel}
              overallSpeedLabel={overallSpeedLabel}
              overallEtaLabel={overallEtaLabel}
              stageDetails={stageDetails}
            />

            {downloadBytesLabel && downloadTotalLabel ? (
              <p className="text-sm text-slate-500">
                Descărcat {downloadBytesLabel} din {downloadTotalLabel}
                {typeof downloadProgressPct === 'number' ? ` · ${downloadProgressPct}%` : ''}
              </p>
            ) : null}

            {isActive && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowRawLogs((prev) => !prev)}
                  className="transition-all duration-200 hover:shadow-[var(--shadow-sm)]"
                >
                  {showRawLogs ? 'Ascunde log-uri brute' : 'Afișează log-uri brute'}
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
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                Log-urile brute sunt ascunse în timpul sincronizării pentru a reduce zgomotul.
              </div>
            )}
          </div>
        </article>
      ) : isSelectedRun && currentRun ? (
        <article className="overflow-hidden rounded-xl border border-slate-200/90 bg-white/80 backdrop-blur-sm p-4 shadow-[var(--shadow-sm)] dark:border-slate-700/60 dark:bg-slate-900/80">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                  Rulare {currentRun.id}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Status: {currentRun.status}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(currentRun.status === 'pending' || currentRun.status === 'running') && (
                  <Button
                    variant="destructive"
                    onClick={abortIngestion}
                    disabled={actionFetcher.state !== 'idle'}
                    className="transition-all duration-200 hover:shadow-[var(--shadow-sm)]"
                  >
                    Anulează rularea
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={() => {
                    void navigate('/ingestion');
                  }}
                  className="transition-all duration-200 hover:shadow-[var(--shadow-sm)]"
                >
                  Resetează selecția
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
        </article>
      ) : (
        <article className="overflow-hidden rounded-xl border border-slate-200/90 bg-white/80 backdrop-blur-sm p-6 shadow-[var(--shadow-sm)] dark:border-slate-700/60 dark:bg-slate-900/80">
          <div className="grid gap-6 lg:grid-cols-[2fr,3fr]">
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                Pornește o sincronizare completă
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Pornește o ingestie completă a catalogului Shopify. Poți monitoriza progresul și
                log-urile în timp real după ce rularea începe.
              </p>
              {recentRuns.length > 0 ? (
                <p className="text-xs text-slate-500">
                  Ultima rulare: {recentRuns[0]?.completedAt ?? recentRuns[0]?.startedAt ?? '—'}
                </p>
              ) : null}
              <span className="inline-flex items-center gap-1.5">
                <Button
                  variant="primary"
                  onClick={startIngestion}
                  loading={actionFetcher.state !== 'idle'}
                  className="transition-all duration-200 hover:shadow-[var(--shadow-sm)]"
                >
                  Pornește sync complet
                </Button>
                <InfoTooltip title="Pornește sync complet" side="bottom" maxWidth={360}>
                  Lansează o sincronizare în masă cu Shopify: exportă produsele, variantele și
                  metafields, le descarcă, transformă și salvează în baza de date. Poți monitoriza
                  progresul și logurile în timp real după ce rularea începe.
                </InfoTooltip>
              </span>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-4 dark:border-slate-700/60 dark:bg-slate-800/50">
              <FileUpload
                label="Încarcă JSONL manual"
                description="Încarcă un fișier JSONL pentru ingestie fără un bulk run Shopify. Util când ai date exportate manual sau dintr-o sursă externă."
                accept={{ 'application/jsonl': ['.jsonl'], 'application/json': ['.json'] }}
                maxFiles={1}
                maxSize={1024 * 1024 * 1024}
                onUpload={uploadJsonl}
              />
              <div className="mt-2 flex justify-end">
                <InfoTooltip title="Încarcă JSONL manual" side="bottom" maxWidth={360}>
                  Încarcă un fișier JSONL (un obiect JSON per linie) cu produse. Nu necesită bulk
                  run Shopify — util pentru date exportate manual, migrări sau surse externe.
                  Formatul trebuie să corespundă structurii produselor Shopify.
                </InfoTooltip>
              </div>
            </div>
          </div>
        </article>
      )}
    </div>
  );
}
