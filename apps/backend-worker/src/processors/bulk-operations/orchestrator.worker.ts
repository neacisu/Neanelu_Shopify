/**
 * Bulk Operations Orchestrator Worker
 *
 * PR-036 (F5.1.1-F5.1.3):
 * - Creates/resumes bulk_runs
 * - Enforces 1 active bulk per shop (Redis lock + DB partial unique index)
 * - Starts Shopify bulkOperationRunQuery
 * - Enqueues poller job boundary (processor lands in PR-037)
 */

import { loadEnv, SHOPIFY_API_VERSION } from '@app/config';
import { logAuditEvent, withTenantContext } from '@app/database';
import { OTEL_ATTR, withSpan, type Logger } from '@app/logger';
import {
  validateBulkOrchestratorJobPayload,
  type BulkOrchestratorJobPayload,
  validateBulkPollerJobPayload,
  type BulkPollerJobPayload,
} from '@app/types';
import {
  acquireBulkLock,
  configFromEnv,
  createWorker,
  releaseBulkLock,
  startBulkLockRenewal,
  withJobTelemetryContext,
  enqueueBulkPollerJob,
  BULK_QUEUE_NAME,
  type DlqEntry,
  type DlqQueueLike,
} from '@app/queue-manager';
import Redis from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';
import { ShopifyRateLimitedError } from '@app/shopify-client';

import { shopifyApi } from '../../shopify/client.js';
import {
  gateShopifyGraphqlRequest,
  getShopifyGraphqlRateLimitConfig,
} from '../../shopify/graphql-rate-limit.js';
import { withTokenRetry } from '../../auth/token-lifecycle.js';
import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';

import {
  sha256Hex,
  deriveIdempotencyKey,
  insertOrLoadBulkRun,
  insertBulkStep,
  markBulkRunFailed,
  markBulkRunStarted,
  patchBulkRunCursorState,
} from './state-machine.js';

import { enqueueDlqDirect } from './failure-handler.js';

const env = loadEnv();

const RedisCtor = Redis as unknown as new (url: string) => RedisClient;

export interface BulkOrchestratorWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  redis: RedisClient;
  close: () => Promise<void>;
}

class BulkLockContentionError extends Error {
  public readonly delayMs: number;

  constructor(delayMs: number) {
    super('bulk_lock_contention');
    Object.setPrototypeOf(this, BulkLockContentionError.prototype);
    this.name = 'BulkLockContentionError';
    this.delayMs = Math.max(0, Math.floor(delayMs));
  }
}

function buildBulkRunQueryMutation(): string {
  // Shopify expects the query argument to be a single string.
  // Using a GraphQL block string avoids escaping most query content.
  return `mutation BulkRun($query: String!) {
  bulkOperationRunQuery(query: $query) {
    bulkOperation { id status }
    userErrors { field message }
  }
}`;
}

function isPermanentBulkStartError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('access denied') ||
    m.includes('unauthorized') ||
    m.includes('forbidden') ||
    m.includes('invalid') ||
    m.includes('not installed') ||
    m.includes('missing scope')
  );
}

function classifyPermanentBulkStartErrorType(
  message: string
): 'INVALID_QUERY' | 'AUTH_FAILED' | 'UNKNOWN' {
  const m = message.toLowerCase();
  if (m.includes('invalid')) return 'INVALID_QUERY';
  if (
    m.includes('access denied') ||
    m.includes('unauthorized') ||
    m.includes('forbidden') ||
    m.includes('missing scope')
  ) {
    return 'AUTH_FAILED';
  }
  if (m.includes('not installed')) return 'AUTH_FAILED';
  return 'UNKNOWN';
}

export function startBulkOrchestratorWorker(logger: Logger): BulkOrchestratorWorkerHandle {
  const redis = new RedisCtor(env.redisUrl);
  const qmOptions = { config: configFromEnv(env) };
  const graphqlLimiterCfg = getShopifyGraphqlRateLimitConfig();

  let dlqQueueRef: DlqQueueLike | null = null;

  const created = createWorker<BulkOrchestratorJobPayload>(qmOptions, {
    name: BULK_QUEUE_NAME,
    enableDelayHandling: true,
    enableDlq: true,
    processor: async (job) => {
      return withJobTelemetryContext(job, async () => {
        const jobId = String(job.id ?? job.name);

        const baseAttrs: Record<string, string | number | boolean> = {
          [OTEL_ATTR.QUEUE_NAME]: BULK_QUEUE_NAME,
          [OTEL_ATTR.QUEUE_JOB_ID]: jobId,
          [OTEL_ATTR.QUEUE_JOB_NAME]: String(job.name),
        };

        return withSpan('queue.process', baseAttrs, async (span) => {
          const payloadUnknown: unknown = job.data;
          if (!validateBulkOrchestratorJobPayload(payloadUnknown)) {
            logger.warn(
              { event: 'job.drop', jobId: job.id, name: job.name, queueName: BULK_QUEUE_NAME },
              'Bulk orchestrator job payload failed validation (dropping)'
            );
            return;
          }

          const payload = payloadUnknown;
          span.setAttribute(OTEL_ATTR.SHOP_ID, payload.shopId);
          span.setAttribute(OTEL_ATTR.QUEUE_GROUP_ID, payload.shopId);
          span.setAttribute('bulk.operation_type', payload.operationType);
          if (payload.queryType) span.setAttribute('bulk.query_type', payload.queryType);
          if (payload.queryVersion) span.setAttribute('bulk.query_version', payload.queryVersion);

          setWorkerCurrentJob('bulk-orchestrator-worker', {
            jobId,
            jobName: String(job.name),
            startedAtIso: new Date().toISOString(),
            progressPct: null,
          });

          const ttlMs = 30 * 60_000;
          const lock = await acquireBulkLock(redis, payload.shopId, { ttlMs });
          if (!lock) {
            // Contention is expected; do not fail the job.
            throw new BulkLockContentionError(60_000);
          }

          const renewal = startBulkLockRenewal(redis, lock, {
            ttlMs,
            refreshIntervalMs: 60_000,
          });

          try {
            const graphqlQueryHash = sha256Hex(payload.graphqlQuery);
            const idempotencyKey = payload.idempotencyKey?.trim()
              ? payload.idempotencyKey.trim()
              : deriveIdempotencyKey({
                  shopId: payload.shopId,
                  operationType: payload.operationType,
                  queryType: payload.queryType ?? null,
                  graphqlQueryHash,
                });

            const run = await insertOrLoadBulkRun({
              shopId: payload.shopId,
              operationType: payload.operationType,
              queryType: payload.queryType ?? null,
              idempotencyKey,
              graphqlQueryHash,
            });

            // Persist contract metadata for deterministic retries/recovery.
            // Use cursor_state as a forward-compatible JSONB bag.
            await patchBulkRunCursorState({
              shopId: payload.shopId,
              bulkRunId: run.id,
              patch: {
                bulkQueryContract: {
                  queryType: payload.queryType ?? null,
                  version: payload.queryVersion ?? null,
                  graphqlQueryHash,
                },
              },
            });

            // If the run already has a Shopify operation id, it was started before (idempotent resume).
            if (run.shopify_operation_id) {
              const pollerPayload: BulkPollerJobPayload = {
                shopId: payload.shopId,
                bulkRunId: run.id,
                shopifyOperationId: run.shopify_operation_id,
                triggeredBy: payload.triggeredBy,
                requestedAt: Date.now(),
              };
              if (validateBulkPollerJobPayload(pollerPayload)) {
                await enqueueBulkPollerJob(pollerPayload, logger);
              }
              return;
            }

            await insertBulkStep({
              shopId: payload.shopId,
              bulkRunId: run.id,
              stepName: 'orchestrator.acquire_lock',
              status: 'completed',
            });

            // Start Shopify bulk operation outside DB tx.
            const encryptionKey = Buffer.from(env.encryptionKeyHex, 'hex');

            // Proactive (distributed) GraphQL rate limiting.
            // Reactive throttling is handled by shopifyApi client (ShopifyRateLimitedError).
            await gateShopifyGraphqlRequest({
              redis,
              shopId: payload.shopId,
              costToConsume: graphqlLimiterCfg.defaultBulkStartCost,
              config: graphqlLimiterCfg,
            });

            const { bulkOperationId, costEstimate } = await withTokenRetry(
              payload.shopId,
              encryptionKey,
              logger,
              async (accessToken, shopDomain) => {
                const client = shopifyApi.createClient({
                  shopDomain,
                  accessToken,
                  apiVersion: SHOPIFY_API_VERSION,
                });

                const mutation = buildBulkRunQueryMutation();
                const variables = { query: payload.graphqlQuery };
                const res = await client.request<{
                  bulkOperationRunQuery?: {
                    bulkOperation?: { id?: string | null; status?: string | null } | null;
                    userErrors?: { field?: string[] | null; message?: string | null }[] | null;
                  };
                }>(mutation, variables);

                const userErrors = res.data?.bulkOperationRunQuery?.userErrors ?? [];
                if (userErrors.length) {
                  const message = userErrors
                    .map((e) => e?.message)
                    .filter((m): m is string => Boolean(m))
                    .join('; ');
                  throw new Error(message || 'bulk_run_user_errors');
                }

                const opId = res.data?.bulkOperationRunQuery?.bulkOperation?.id;
                if (!opId) {
                  throw new Error('bulk_operation_id_missing');
                }

                const actualCost = res.extensions?.cost?.actualQueryCost;
                const estimate =
                  typeof actualCost === 'number' && Number.isFinite(actualCost) ? actualCost : null;

                return { bulkOperationId: opId, costEstimate: estimate };
              }
            );

            await markBulkRunStarted({
              shopId: payload.shopId,
              bulkRunId: run.id,
              shopifyOperationId: bulkOperationId,
              apiVersion: SHOPIFY_API_VERSION,
              costEstimate,
            });

            await insertBulkStep({
              shopId: payload.shopId,
              bulkRunId: run.id,
              stepName: 'orchestrator.start_shopify_bulk',
              status: 'completed',
            });

            await logAuditEvent('bulk_operation_started', {
              actorType: payload.triggeredBy === 'manual' ? 'user' : 'system',
              shopId: payload.shopId,
              resourceType: 'bulk_runs',
              resourceId: run.id,
              details: {
                operationType: payload.operationType,
                queryType: payload.queryType ?? null,
                idempotencyKey,
                shopifyOperationId: bulkOperationId,
              },
            });

            const pollerPayload: BulkPollerJobPayload = {
              shopId: payload.shopId,
              bulkRunId: run.id,
              shopifyOperationId: bulkOperationId,
              triggeredBy: payload.triggeredBy,
              requestedAt: Date.now(),
            };

            if (validateBulkPollerJobPayload(pollerPayload)) {
              await enqueueBulkPollerJob(pollerPayload, logger);
            }
          } catch (err) {
            if (err instanceof ShopifyRateLimitedError) {
              // Allow delay handling to reschedule without consuming attempts.
              throw err;
            }

            const errorMessage = err instanceof Error ? err.message : 'unknown_error';

            // Permanent failures (invalid query/auth) should go to DLQ immediately.
            // We still persist bulk_runs/bulk_errors best-effort.
            if (isPermanentBulkStartError(errorMessage)) {
              try {
                const errorType = classifyPermanentBulkStartErrorType(errorMessage);
                const entry: DlqEntry = {
                  originalQueue: BULK_QUEUE_NAME,
                  originalJobId: job?.id != null ? String(job.id) : null,
                  originalJobName: String(job?.name ?? 'bulk.orchestrator.start'),
                  attemptsMade: job?.attemptsMade ?? 0,
                  failedReason: errorMessage,
                  stacktrace: job?.stacktrace ?? [],
                  data: {
                    originalJob: {
                      queue: BULK_QUEUE_NAME,
                      id: job?.id != null ? String(job.id) : null,
                      name: String(job?.name ?? 'bulk.orchestrator.start'),
                      data: job?.data,
                    },
                    errorType,
                    attempts: {
                      retryCount: job?.attemptsMade ?? 0,
                      maxRetries: job?.opts?.attempts ?? null,
                    },
                    lastError: {
                      message: errorMessage,
                    },
                  },
                  occurredAt: new Date().toISOString(),
                };
                await enqueueDlqDirect({ dlqQueue: dlqQueueRef, entry });
              } catch {
                // best-effort
              }
              logger.error(
                {
                  event: 'bulk.orchestrator.permanent_fail',
                  queueName: BULK_QUEUE_NAME,
                  jobId,
                  shopId: (job.data as { shopId?: unknown } | undefined)?.shopId,
                  err,
                },
                'Bulk orchestrator permanent failure (DLQ direct)'
              );
              return;
            }
            logger.error(
              {
                event: 'bulk.orchestrator.fail',
                queueName: BULK_QUEUE_NAME,
                jobId,
                shopId: (job.data as { shopId?: unknown } | undefined)?.shopId,
                err,
              },
              'Bulk orchestrator failed'
            );

            // Best-effort failure persistence; do not mask the root error.
            try {
              const shopId = validateBulkOrchestratorJobPayload(job.data) ? job.data.shopId : null;
              if (shopId) {
                // Attempt to resolve run by idempotency and mark failed.
                const idempotencyKey =
                  typeof job.data.idempotencyKey === 'string' ? job.data.idempotencyKey : null;
                if (idempotencyKey) {
                  const run = await withTenantContext(shopId, async (client) => {
                    const res = await client.query<{ id: string }>(
                      `SELECT id FROM bulk_runs WHERE idempotency_key = $1 LIMIT 1`,
                      [idempotencyKey]
                    );
                    return res.rows[0]?.id ?? null;
                  });
                  if (run) {
                    await markBulkRunFailed({
                      shopId,
                      bulkRunId: run,
                      errorMessage,
                      errorType: 'orchestrator',
                      errorCode: 'BULK_ORCHESTRATOR_FAILED',
                    });

                    await logAuditEvent('bulk_operation_failed', {
                      actorType: 'system',
                      shopId,
                      resourceType: 'bulk_runs',
                      resourceId: run,
                      details: { errorMessage },
                    });
                  }
                }
              }
            } catch {
              // best-effort
            }

            throw err;
          } finally {
            renewal.stop();
            await releaseBulkLock(redis, lock).catch(() => false);
            clearWorkerCurrentJob('bulk-orchestrator-worker', jobId);
          }
        });
      });
    },
    workerOptions: {
      concurrency: env.maxGlobalConcurrency,
      group: { concurrency: env.maxActivePerShop },
    },
  });

  const { worker, dlqQueue } = created;
  dlqQueueRef = (dlqQueue as DlqQueueLike | null | undefined) ?? null;

  const close = async (): Promise<void> => {
    await worker.close();
    await dlqQueue?.close().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  };

  return { worker, redis, close };
}
