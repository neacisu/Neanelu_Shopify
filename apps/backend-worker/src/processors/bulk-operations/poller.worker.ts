import {
  BULK_POLLER_QUEUE_NAME,
  createWorker,
  withJobTelemetryContext,
  configFromEnv,
  enqueueBulkMutationReconcileJob,
  enqueueBulkIngestJob,
  type DlqEntry,
  type DlqQueueLike,
} from '@app/queue-manager';
import { loadEnv, SHOPIFY_API_VERSION } from '@app/config';
import { OTEL_ATTR, type Logger } from '@app/logger';
import { validateBulkPollerJobPayload, type BulkPollerJobPayload } from '@app/types';
import { withTenantContext } from '@app/database';
import { withTokenRetry } from '../../auth/token-lifecycle.js';
import { shopifyApi } from '../../shopify/client.js';
import {
  gateShopifyGraphqlRequest,
  getShopifyGraphqlRateLimitConfig,
  syncShopifyGraphqlThrottleStatus,
} from '../../shopify/graphql-rate-limit.js';
import { computeGraphqlDelayMs } from '@app/shopify-client';
import { Redis as IORedis, type Redis } from 'ioredis';
import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';
import {
  insertBulkError,
  loadBulkRunContext,
  markBulkRunInProgress,
  markBulkRunFailed,
  patchBulkRunCursorState,
  assertValidBulkRunTransition,
} from './state-machine.js';
import {
  classifyBulkTerminalFailure,
  enqueueDlqDirect,
  enqueueRetryOrDlq,
} from './failure-handler.js';
import {
  decrementBulkActiveOperations,
  recordBulkOperationDuration,
  recordBulkOperationFailure,
  setBulkOperationRunningAgeSeconds,
} from '../../otel/metrics.js';
import {
  recordBulkCompletedEvent,
  recordBulkDlqEvent,
  recordBulkFailedEvent,
} from './otel/events.js';
import { withBulkSpan } from './otel/spans.js';

const env = loadEnv();

const POLL_BACKOFF_MS = [5_000, 10_000, 20_000, 30_000] as const;
const TIMEOUT_MS = 4 * 60 * 60 * 1000;
const SHOPIFY_BULK_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function computeDurationSeconds(
  createdAt?: string | null,
  completedAt?: string | null,
  fallbackStartMs?: number | null
): number | null {
  const createdMs = createdAt ? Date.parse(createdAt) : NaN;
  const completedMs = completedAt ? Date.parse(completedAt) : NaN;
  if (Number.isFinite(createdMs) && Number.isFinite(completedMs)) {
    return Math.max(0, (completedMs - createdMs) / 1000);
  }
  if (Number.isFinite(createdMs)) {
    return Math.max(0, (Date.now() - createdMs) / 1000);
  }
  if (typeof fallbackStartMs === 'number' && Number.isFinite(fallbackStartMs)) {
    return Math.max(0, (Date.now() - fallbackStartMs) / 1000);
  }
  return null;
}

interface JobWithUpdateData<T> {
  id?: string | number | null;
  name?: string | null;
  data: T;
  updateData?: (data: T) => Promise<unknown>;
}

class PollerDelayError extends Error {
  public readonly delayMs: number;

  constructor(message: string, delayMs: number) {
    super(message);
    Object.setPrototypeOf(this, PollerDelayError.prototype);
    this.name = 'PollerDelayError';
    this.delayMs = Math.max(0, Math.floor(delayMs));
  }
}

type ShopifyBulkOpStatus =
  | 'CREATED'
  | 'CANCELING'
  | 'CANCELED'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED'
  | 'RUNNING';

interface ShopifyBulkOperationNode {
  __typename: 'BulkOperation';
  id: string;
  status: ShopifyBulkOpStatus;
  errorCode?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
  objectCount?: string | null;
  fileSize?: string | null;
  url?: string | null;
  partialDataUrl?: string | null;
}

function isBulkOperationNode(node: unknown): node is ShopifyBulkOperationNode {
  if (!node || typeof node !== 'object') return false;
  return (node as { __typename?: unknown }).__typename === 'BulkOperation';
}

const BULK_OPERATION_NODE_QUERY = `#graphql
  query BulkOperationNode($id: ID!) {
    node(id: $id) {
      __typename
      ... on BulkOperation {
        id
        status
        errorCode
        createdAt
        completedAt
        objectCount
        fileSize
        url
        partialDataUrl
      }
    }
  }
`;

function nextBackoffMs(attempt: number): number {
  const idx = Math.max(0, Math.min(POLL_BACKOFF_MS.length - 1, attempt));
  // idx is clamped to valid tuple bounds.
  return POLL_BACKOFF_MS[idx] as number;
}

function safeIntFromString(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function extractBulkIdentifiers(data: unknown): { shopId?: string; bulkRunId?: string } {
  if (!data || typeof data !== 'object') return {};
  const obj = data as Record<string, unknown>;
  const shopId = typeof obj['shopId'] === 'string' ? obj['shopId'] : undefined;
  const bulkRunId = typeof obj['bulkRunId'] === 'string' ? obj['bulkRunId'] : undefined;
  const out: { shopId?: string; bulkRunId?: string } = {};
  if (shopId) out.shopId = shopId;
  if (bulkRunId) out.bulkRunId = bulkRunId;
  return out;
}

async function insertStep(params: {
  shopId: string;
  bulkRunId: string;
  step: string;
  status?: 'completed' | 'failed';
  errorMessage?: string | null;
  details?: unknown;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    const status = params.status ?? 'completed';
    await client.query(
      `INSERT INTO bulk_steps (
         bulk_run_id,
         shop_id,
         step_name,
         step_order,
         status,
         started_at,
         completed_at,
         error_message,
         error_details,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, 0, $4, now(), now(), $5, $6::jsonb, now(), now())`,
      [
        params.bulkRunId,
        params.shopId,
        params.step,
        status,
        params.errorMessage ?? null,
        params.details ?? null,
      ]
    );
  });
}

async function markRunCompleted(params: {
  shopId: string;
  bulkRunId: string;
  resultUrl: string;
  partialDataUrl?: string | null;
  objectCount?: number | null;
  resultSizeBytes?: number | null;
  shopifyCompletedAt?: Date | null;
}): Promise<void> {
  await assertValidBulkRunTransition({
    shopId: params.shopId,
    bulkRunId: params.bulkRunId,
    nextStatus: 'completed',
  });
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE bulk_runs
       SET status = 'completed',
           completed_at = COALESCE($1::timestamptz, completed_at, now()),
           result_url = $2,
           result_size_bytes = COALESCE($3::bigint, result_size_bytes),
           partial_data_url = COALESCE($4::text, partial_data_url),
           records_processed = COALESCE($5::int, records_processed),
           updated_at = now()
       WHERE id = $6`,
      [
        params.shopifyCompletedAt ? params.shopifyCompletedAt.toISOString() : null,
        params.resultUrl,
        params.resultSizeBytes ?? null,
        params.partialDataUrl ?? null,
        params.objectCount ?? null,
        params.bulkRunId,
      ]
    );

    // Store the URL as an artifact as well (useful for later download pipeline).
    // bulk_artifacts requires file_path; use a stable logical path.
    const existing = await client.query<{ ok: number }>(
      `SELECT 1 as ok
       FROM bulk_artifacts
       WHERE bulk_run_id = $1
         AND shop_id = $2
         AND artifact_type = 'shopify_bulk_result_url'
       LIMIT 1`,
      [params.bulkRunId, params.shopId]
    );

    if (existing.rows.length === 0) {
      const expiresAt = new Date(Date.now() + SHOPIFY_BULK_URL_TTL_MS);
      await client.query(
        `INSERT INTO bulk_artifacts (
           bulk_run_id,
           shop_id,
           artifact_type,
           file_path,
           url,
           bytes_size,
           expires_at,
           created_at
         )
         VALUES ($1, $2, 'shopify_bulk_result_url', $3, $4, $5, $6, now())`,
        [
          params.bulkRunId,
          params.shopId,
          `shopify://bulk/${params.bulkRunId}/result`,
          params.resultUrl,
          params.resultSizeBytes ?? null,
          expiresAt.toISOString(),
        ]
      );
    }
  });
}

async function ensureUrlArtifact(params: {
  shopId: string;
  bulkRunId: string;
  artifactType: 'shopify_bulk_partial_url' | 'shopify_bulk_result_url';
  filePath: string;
  url: string;
  bytesSize?: number | null;
  expiresAt?: Date | null;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    const existing = await client.query<{ ok: number }>(
      `SELECT 1 as ok
       FROM bulk_artifacts
       WHERE bulk_run_id = $1
         AND shop_id = $2
         AND artifact_type = $3
         AND url = $4
       LIMIT 1`,
      [params.bulkRunId, params.shopId, params.artifactType, params.url]
    );

    if (existing.rows.length > 0) return;

    await client.query(
      `INSERT INTO bulk_artifacts (
         bulk_run_id,
         shop_id,
         artifact_type,
         file_path,
         url,
         bytes_size,
         expires_at,
         created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [
        params.bulkRunId,
        params.shopId,
        params.artifactType,
        params.filePath,
        params.url,
        params.bytesSize ?? null,
        params.expiresAt ? params.expiresAt.toISOString() : null,
      ]
    );
  });
}

async function recordPartialDataUrlForResume(params: {
  shopId: string;
  bulkRunId: string;
  partialDataUrl: string;
}): Promise<void> {
  // Persist separately for later pipeline resume/salvage (Plan F5.1.7).
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE bulk_runs
       SET partial_data_url = $1,
           updated_at = now()
       WHERE id = $2
         AND (partial_data_url IS DISTINCT FROM $1)`,
      [params.partialDataUrl, params.bulkRunId]
    );
  });

  await patchBulkRunCursorState({
    shopId: params.shopId,
    bulkRunId: params.bulkRunId,
    patch: {
      resume: {
        source: 'partialDataUrl',
        available: true,
        observedAt: new Date().toISOString(),
      },
      partialDataUrl: params.partialDataUrl,
    },
  });
}

async function updateJobDataSafe(
  job: JobWithUpdateData<BulkPollerJobPayload> | null | undefined,
  data: BulkPollerJobPayload
): Promise<void> {
  if (!job?.updateData) return;
  await job.updateData(data);
}

export interface BulkPollerWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  redis: Redis;
  close: () => Promise<void>;
}

export function startBulkPollerWorker(logger: Logger): BulkPollerWorkerHandle {
  const redis: Redis = new IORedis(env.redisUrl);
  const cfg = getShopifyGraphqlRateLimitConfig();
  const qmOptions = { config: configFromEnv(env) };

  let dlqQueueRef: DlqQueueLike | null = null;

  const created = createWorker<BulkPollerJobPayload>(qmOptions, {
    name: BULK_POLLER_QUEUE_NAME,
    enableDelayHandling: true,
    enableDlq: true,
    onDlqEntry: (entry) => {
      const { shopId, bulkRunId } = extractBulkIdentifiers(entry.data);
      recordBulkDlqEvent({
        shopId: shopId ?? null,
        bulkRunId: bulkRunId ?? null,
        queueName: entry.originalQueue,
        jobName: entry.originalJobName,
        jobId: entry.originalJobId,
      });
    },
    processor: async (job) => {
      return await withJobTelemetryContext(job, async () => {
        const jobId = String(job.id ?? job.name);
        const payloadUnknown: unknown = job.data;
        if (!validateBulkPollerJobPayload(payloadUnknown)) {
          logger.warn(
            { event: 'job.drop', jobId: job.id, name: job.name, queueName: BULK_POLLER_QUEUE_NAME },
            'Bulk poller job payload failed validation (dropping)'
          );
          return;
        }

        const payload = payloadUnknown;
        const ctx = await loadBulkRunContext({
          shopId: payload.shopId,
          bulkRunId: payload.bulkRunId,
        });
        const operationType = ctx?.operation_type ?? 'unknown';
        const queryType = ctx?.query_type ?? null;

        setWorkerCurrentJob('bulk-poller-worker', {
          jobId,
          jobName: String(job.name),
          startedAtIso: new Date().toISOString(),
          progressPct: null,
        });

        if (ctx) {
          await markBulkRunInProgress({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
            status: 'polling',
          });
        }

        try {
          return await withBulkSpan(
            'bulk.poll',
            {
              shopId: payload.shopId,
              bulkRunId: payload.bulkRunId,
              operationType,
              queryType,
              step: 'poll',
            },
            async () => {
              const pollAttempt =
                typeof payload.pollAttempt === 'number' && Number.isFinite(payload.pollAttempt)
                  ? Math.max(0, Math.trunc(payload.pollAttempt))
                  : 0;

              const ageMs = Date.now() - new Date(payload.requestedAt).getTime();
              if (ageMs > TIMEOUT_MS) {
                await insertStep({
                  shopId: payload.shopId,
                  bulkRunId: payload.bulkRunId,
                  step: 'poller.timeout',
                  status: 'failed',
                  details: { ageMs },
                });
                await markBulkRunFailed({
                  shopId: payload.shopId,
                  bulkRunId: payload.bulkRunId,
                  errorType: 'poller_timeout',
                  errorCode: 'timeout',
                  errorMessage: `Poll timeout after ${Math.round(ageMs / 1000)}s`,
                });
                recordBulkFailedEvent({
                  shopId: payload.shopId,
                  bulkRunId: payload.bulkRunId,
                  operationType,
                  errorType: 'poller_timeout',
                  retryable: false,
                });
                return { outcome: 'timeout' as const };
              }

              await insertStep({
                shopId: payload.shopId,
                bulkRunId: payload.bulkRunId,
                step: 'poller.tick',
                details: { pollAttempt },
              });

              await gateShopifyGraphqlRequest({
                redis,
                shopId: payload.shopId,
                costToConsume: cfg.defaultPollCost,
                config: cfg,
              });

              const encryptionKey = Buffer.from(env.encryptionKeyHex, 'hex');

              const res = await withTokenRetry(
                payload.shopId,
                encryptionKey,
                logger,
                async (accessToken, shopDomain) => {
                  const client = shopifyApi.createClient({
                    shopDomain,
                    accessToken,
                    apiVersion: SHOPIFY_API_VERSION,
                  });

                  return await client.request<{
                    node: ShopifyBulkOperationNode | { __typename: string } | null;
                  }>(BULK_OPERATION_NODE_QUERY, { id: payload.shopifyOperationId });
                }
              );

              let throttleDelayMs = 0;
              const throttleStatus = res?.extensions?.cost?.throttleStatus;
              if (
                throttleStatus &&
                typeof throttleStatus.currentlyAvailable === 'number' &&
                typeof throttleStatus.restoreRate === 'number'
              ) {
                throttleDelayMs = computeGraphqlDelayMs({
                  costNeeded: cfg.defaultPollCost,
                  currentlyAvailable: throttleStatus.currentlyAvailable,
                  restoreRate: throttleStatus.restoreRate,
                });

                await syncShopifyGraphqlThrottleStatus({
                  redis,
                  shopId: payload.shopId,
                  throttleStatus,
                  config: cfg,
                }).catch(() => undefined);
              }

              const node = res?.data?.node;
              if (!isBulkOperationNode(node)) {
                const delayMs = Math.max(nextBackoffMs(pollAttempt), throttleDelayMs);
                await updateJobDataSafe(job as JobWithUpdateData<BulkPollerJobPayload>, {
                  ...payload,
                  pollAttempt: pollAttempt + 1,
                });
                throw new PollerDelayError('bulk_operation_not_found_yet', delayMs);
              }

              const bulk = node;
              logger.info(
                {
                  [OTEL_ATTR.SHOP_ID]: payload.shopId,
                  jobId,
                  bulkRunId: payload.bulkRunId,
                  status: bulk.status,
                  objectCount: safeIntFromString(bulk.objectCount),
                  fileSizeBytes: safeIntFromString(bulk.fileSize),
                },
                'Polled bulk operation status'
              );

              if (bulk.partialDataUrl) {
                await recordPartialDataUrlForResume({
                  shopId: payload.shopId,
                  bulkRunId: payload.bulkRunId,
                  partialDataUrl: bulk.partialDataUrl,
                });
                const expiresAt = new Date(Date.now() + SHOPIFY_BULK_URL_TTL_MS);
                await ensureUrlArtifact({
                  shopId: payload.shopId,
                  bulkRunId: payload.bulkRunId,
                  artifactType: 'shopify_bulk_partial_url',
                  filePath: `shopify://bulk/${payload.bulkRunId}/partial`,
                  url: bulk.partialDataUrl,
                  bytesSize: safeIntFromString(bulk.fileSize),
                  expiresAt,
                });
              }

              if (bulk.status === 'COMPLETED') {
                const resultUrl = bulk.url ?? null;
                const fallbackUrl = bulk.partialDataUrl ?? null;
                const chosenUrl = resultUrl ?? fallbackUrl;
                if (!chosenUrl) {
                  await insertStep({
                    shopId: payload.shopId,
                    bulkRunId: payload.bulkRunId,
                    step: 'poller.completed_missing_url',
                    status: 'failed',
                    details: { status: bulk.status, errorCode: bulk.errorCode },
                  });
                  await markBulkRunFailed({
                    shopId: payload.shopId,
                    bulkRunId: payload.bulkRunId,
                    errorType: 'poller_completed_missing_url',
                    errorCode: 'completed_missing_url',
                    errorMessage: 'Bulk operation completed but no URL was provided by Shopify',
                  });
                  return { outcome: 'failed' as const };
                }

                await insertStep({
                  shopId: payload.shopId,
                  bulkRunId: payload.bulkRunId,
                  step: 'poller.completed',
                  details: {
                    objectCount: safeIntFromString(bulk.objectCount),
                    fileSize: safeIntFromString(bulk.fileSize),
                  },
                });

                const completedAt = bulk.completedAt ? new Date(bulk.completedAt) : null;
                await markRunCompleted({
                  shopId: payload.shopId,
                  bulkRunId: payload.bulkRunId,
                  resultUrl: chosenUrl,
                  partialDataUrl: bulk.partialDataUrl ?? null,
                  objectCount: safeIntFromString(bulk.objectCount),
                  resultSizeBytes: safeIntFromString(bulk.fileSize),
                  shopifyCompletedAt: completedAt,
                });

                const durationSeconds = computeDurationSeconds(
                  bulk.createdAt ?? null,
                  bulk.completedAt ?? null,
                  payload.requestedAt ?? null
                );
                if (durationSeconds != null) {
                  recordBulkOperationDuration({
                    operationType,
                    status: 'completed',
                    durationSeconds,
                  });
                }
                decrementBulkActiveOperations(operationType);
                recordBulkCompletedEvent({
                  shopId: payload.shopId,
                  bulkRunId: payload.bulkRunId,
                  operationType,
                  rowsProcessed: safeIntFromString(bulk.objectCount),
                  durationSeconds: durationSeconds ?? null,
                });

                // PR-039: if this run is a bulk mutation, enqueue reconcile.
                try {
                  const cursor = ctx?.cursor_state;
                  const isMutationRun =
                    !!cursor &&
                    typeof cursor === 'object' &&
                    cursor !== null &&
                    'bulkMutationContract' in (cursor as Record<string, unknown>);

                  if (isMutationRun) {
                    await enqueueBulkMutationReconcileJob({
                      shopId: payload.shopId,
                      bulkRunId: payload.bulkRunId,
                      resultUrl: chosenUrl,
                      triggeredBy: payload.triggeredBy,
                      requestedAt: Date.now(),
                    });

                    await insertStep({
                      shopId: payload.shopId,
                      bulkRunId: payload.bulkRunId,
                      step: 'poller.reconcile_enqueued',
                      details: { resultUrl: chosenUrl },
                    });
                  } else {
                    // PR-042: for query runs, enqueue the ingestion boundary (COPY+merge).
                    await enqueueBulkIngestJob({
                      shopId: payload.shopId,
                      bulkRunId: payload.bulkRunId,
                      resultUrl: chosenUrl,
                      triggeredBy: payload.triggeredBy,
                      requestedAt: Date.now(),
                    });

                    await insertStep({
                      shopId: payload.shopId,
                      bulkRunId: payload.bulkRunId,
                      step: 'poller.ingest_enqueued',
                      details: { resultUrl: chosenUrl },
                    });
                  }
                } catch {
                  // Best-effort: poller should not fail due to reconcile enqueue.
                }

                return { outcome: 'completed' as const, resultUrl: chosenUrl };
              }

              if (
                bulk.status === 'FAILED' ||
                bulk.status === 'CANCELED' ||
                bulk.status === 'EXPIRED'
              ) {
                const decision = classifyBulkTerminalFailure({
                  status: bulk.status,
                  shopifyErrorCode: bulk.errorCode ?? null,
                });
                recordBulkFailedEvent({
                  shopId: payload.shopId,
                  bulkRunId: payload.bulkRunId,
                  operationType,
                  errorType: decision.errorType,
                  retryable: decision.shouldRetry,
                });
                if (bulk.partialDataUrl) {
                  await recordPartialDataUrlForResume({
                    shopId: payload.shopId,
                    bulkRunId: payload.bulkRunId,
                    partialDataUrl: bulk.partialDataUrl,
                  });
                }

                // Always record the terminal failure for audit/debugging.
                await insertBulkError({
                  shopId: payload.shopId,
                  bulkRunId: payload.bulkRunId,
                  errorType: 'poller_terminal',
                  errorCode: bulk.errorCode ?? bulk.status,
                  errorMessage: `Bulk operation terminal status: ${bulk.status}`,
                  payload: { status: bulk.status, errorCode: bulk.errorCode ?? null },
                });

                const dlqContext = {
                  originalQueue: BULK_POLLER_QUEUE_NAME,
                  originalJobId: job?.id != null ? String(job.id) : null,
                  originalJobName: String(job?.name ?? 'bulk.poller'),
                };

                const dlqEnqueue = async (entry: DlqEntry): Promise<void> => {
                  recordBulkDlqEvent({
                    shopId: payload.shopId,
                    bulkRunId: payload.bulkRunId,
                    queueName: entry.originalQueue,
                    jobName: entry.originalJobName,
                    jobId: entry.originalJobId,
                  });
                  await enqueueDlqDirect({
                    dlqQueue: dlqQueueRef,
                    entry,
                  });
                };

                const retryOutcome = await enqueueRetryOrDlq({
                  logger,
                  shopId: payload.shopId,
                  bulkRunId: payload.bulkRunId,
                  triggeredBy: payload.triggeredBy,
                  originalJob: {
                    queue: BULK_POLLER_QUEUE_NAME,
                    id: job?.id != null ? String(job.id) : null,
                    name: String(job?.name ?? 'bulk.poller'),
                    data: job?.data,
                  },
                  dlqEnqueue,
                  dlqContext,
                  terminalStatus: bulk.status,
                  shopifyErrorCode: bulk.errorCode ?? null,
                });

                if (retryOutcome === 'retry_enqueued') {
                  await insertStep({
                    shopId: payload.shopId,
                    bulkRunId: payload.bulkRunId,
                    step: 'poller.retry_enqueued',
                    details: { status: bulk.status, errorCode: bulk.errorCode },
                  });
                  return { outcome: 'retry_enqueued' as const };
                }

                if (retryOutcome === 'salvaged_partial') {
                  // PR-039: if this run is a bulk mutation, enqueue reconcile against partialDataUrl.
                  try {
                    const ctx = await loadBulkRunContext({
                      shopId: payload.shopId,
                      bulkRunId: payload.bulkRunId,
                    });
                    const cursor = ctx?.cursor_state;
                    const isMutationRun =
                      !!cursor &&
                      typeof cursor === 'object' &&
                      cursor !== null &&
                      'bulkMutationContract' in (cursor as Record<string, unknown>);

                    if (isMutationRun && bulk.partialDataUrl) {
                      await enqueueBulkMutationReconcileJob({
                        shopId: payload.shopId,
                        bulkRunId: payload.bulkRunId,
                        resultUrl: bulk.partialDataUrl,
                        triggeredBy: payload.triggeredBy,
                        requestedAt: Date.now(),
                      });
                      await insertStep({
                        shopId: payload.shopId,
                        bulkRunId: payload.bulkRunId,
                        step: 'poller.reconcile_enqueued',
                        details: { resultUrl: bulk.partialDataUrl, salvaged: true },
                      });
                    }
                  } catch {
                    // ignore
                  }

                  await insertStep({
                    shopId: payload.shopId,
                    bulkRunId: payload.bulkRunId,
                    step: 'poller.salvaged_partial',
                    details: { status: bulk.status, errorCode: bulk.errorCode },
                  });
                  return { outcome: 'completed_partial' as const, resultUrl: bulk.partialDataUrl };
                }

                await insertStep({
                  shopId: payload.shopId,
                  bulkRunId: payload.bulkRunId,
                  step: 'poller.failed',
                  status: 'failed',
                  details: { status: bulk.status, errorCode: bulk.errorCode },
                });
                await markBulkRunFailed({
                  shopId: payload.shopId,
                  bulkRunId: payload.bulkRunId,
                  errorType: 'poller_failed',
                  errorCode: bulk.errorCode ?? bulk.status,
                  errorMessage: `Bulk operation terminal status: ${bulk.status}`,
                });
                const durationSeconds = computeDurationSeconds(
                  bulk.createdAt ?? null,
                  bulk.completedAt ?? null,
                  payload.requestedAt ?? null
                );
                if (durationSeconds != null) {
                  recordBulkOperationDuration({
                    operationType,
                    status:
                      bulk.status === 'CANCELED'
                        ? 'canceled'
                        : bulk.status === 'EXPIRED'
                          ? 'expired'
                          : 'failed',
                    durationSeconds,
                  });
                }
                recordBulkOperationFailure({
                  operationType,
                  errorType: decision.errorType,
                });
                decrementBulkActiveOperations(operationType);
                return { outcome: retryOutcome === 'dlq' ? ('dlq' as const) : ('failed' as const) };
              }

              if (bulk.status === 'RUNNING' || bulk.status === 'CREATED') {
                const ageSeconds = computeDurationSeconds(
                  bulk.createdAt ?? null,
                  null,
                  payload.requestedAt ?? null
                );
                if (ageSeconds != null) {
                  setBulkOperationRunningAgeSeconds(operationType, ageSeconds);
                }
              }

              const delayMs = Math.max(nextBackoffMs(pollAttempt), throttleDelayMs);
              await updateJobDataSafe(job as JobWithUpdateData<BulkPollerJobPayload>, {
                ...payload,
                pollAttempt: pollAttempt + 1,
              });
              throw new PollerDelayError('bulk_operation_not_ready', delayMs);
            }
          );
        } finally {
          clearWorkerCurrentJob('bulk-poller-worker', jobId);
        }
      });
    },
    workerOptions: {
      concurrency: env.maxGlobalConcurrency,
      group: { concurrency: env.maxActivePerShop },
    },
  });

  const { worker, dlqQueue } = created;
  dlqQueueRef = (dlqQueue as DlqQueueLike | null | undefined) ?? null;

  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, err }, 'Poller job failed');
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'Bulk poller worker error');
  });

  const close = async (): Promise<void> => {
    await worker.close();
    await dlqQueue?.close().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  };

  return { worker, redis, close };
}
