import {
  BULK_POLLER_QUEUE_NAME,
  createWorker,
  withJobTelemetryContext,
  configFromEnv,
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
} from '../../shopify/graphql-rate-limit.js';
import { Redis as IORedis, type Redis } from 'ioredis';
import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';
import { insertBulkError, markBulkRunFailed, patchBulkRunCursorState } from './state-machine.js';
import { enqueueDlqDirect, enqueueRetryOrDlq } from './failure-handler.js';

const env = loadEnv();

const POLL_BACKOFF_MS = [5_000, 10_000, 20_000, 30_000] as const;
const TIMEOUT_MS = 4 * 60 * 60 * 1000;
const SHOPIFY_BULK_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
  resultSizeBytes?: number | null;
  shopifyCompletedAt?: Date | null;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE bulk_runs
       SET status = 'completed',
           completed_at = COALESCE($1::timestamptz, completed_at, now()),
           result_url = $2,
           result_size_bytes = COALESCE($3::bigint, result_size_bytes),
           partial_data_url = COALESCE($4::text, partial_data_url),
           updated_at = now()
       WHERE id = $5`,
      [
        params.shopifyCompletedAt ? params.shopifyCompletedAt.toISOString() : null,
        params.resultUrl,
        params.resultSizeBytes ?? null,
        params.partialDataUrl ?? null,
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

        setWorkerCurrentJob('bulk-poller-worker', {
          jobId,
          jobName: String(job.name),
          startedAtIso: new Date().toISOString(),
          progressPct: null,
        });

        try {
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

          const node = res?.data?.node;
          if (!isBulkOperationNode(node)) {
            const delayMs = nextBackoffMs(pollAttempt);
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
              resultSizeBytes: safeIntFromString(bulk.fileSize),
              shopifyCompletedAt: completedAt,
            });

            return { outcome: 'completed' as const, resultUrl: chosenUrl };
          }

          if (bulk.status === 'FAILED' || bulk.status === 'CANCELED' || bulk.status === 'EXPIRED') {
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
            return { outcome: retryOutcome === 'dlq' ? ('dlq' as const) : ('failed' as const) };
          }

          const delayMs = nextBackoffMs(pollAttempt);
          await updateJobDataSafe(job as JobWithUpdateData<BulkPollerJobPayload>, {
            ...payload,
            pollAttempt: pollAttempt + 1,
          });
          throw new PollerDelayError('bulk_operation_not_ready', delayMs);
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
