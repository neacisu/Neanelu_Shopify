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
} from '@app/queue-manager';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';
import { ShopifyRateLimitedError } from '@app/shopify-client';

import { shopifyApi } from '../../shopify/client.js';
import { withTokenRetry } from '../../auth/token-lifecycle.js';
import { recordDbQuery } from '../../otel/metrics.js';
import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';

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

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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

type BulkRunRow = Readonly<{
  id: string;
  shop_id: string;
  status: string;
  shopify_operation_id: string | null;
  idempotency_key: string | null;
}>;

async function insertOrLoadBulkRun(params: {
  shopId: string;
  operationType: string;
  queryType: string | null;
  idempotencyKey: string;
  graphqlQueryHash: string;
}): Promise<BulkRunRow> {
  const started = Date.now();
  try {
    return await withTenantContext(params.shopId, async (client) => {
      const result = await client.query<BulkRunRow>(
        `INSERT INTO bulk_runs (
           shop_id,
           operation_type,
           query_type,
           status,
           idempotency_key,
           graphql_query_hash,
           retry_count,
           max_retries,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, 'pending', $4, $5, 0, 3, now(), now())
         RETURNING id, shop_id, status, shopify_operation_id, idempotency_key`,
        [
          params.shopId,
          params.operationType,
          params.queryType,
          params.idempotencyKey,
          params.graphqlQueryHash,
        ]
      );

      const row = result.rows[0];
      if (!row) throw new Error('bulk_run_insert_missing_row');
      return row;
    });
  } catch (err) {
    // Unique violations can happen for:
    // - idempotency_key unique constraint
    // - idx_bulk_runs_active_shop partial unique index
    const message = err instanceof Error ? err.message : String(err);
    if (!message.toLowerCase().includes('duplicate key value')) throw err;

    return await withTenantContext(params.shopId, async (client) => {
      // Prefer idempotency lookup; this makes retries deterministic.
      const byIdempotency = await client.query<BulkRunRow>(
        `SELECT id, shop_id, status, shopify_operation_id, idempotency_key
         FROM bulk_runs
         WHERE idempotency_key = $1
         LIMIT 1`,
        [params.idempotencyKey]
      );
      if (byIdempotency.rows[0]) return byIdempotency.rows[0];

      // Fallback: active run for shop (should be at most 1 by DB constraint).
      const active = await client.query<BulkRunRow>(
        `SELECT id, shop_id, status, shopify_operation_id, idempotency_key
         FROM bulk_runs
         WHERE shop_id = $1
           AND status IN ('pending', 'running')
         ORDER BY created_at DESC
         LIMIT 1`,
        [params.shopId]
      );
      const row = active.rows[0];
      if (!row) throw err;
      return row;
    });
  } finally {
    recordDbQuery('insert', (Date.now() - started) / 1000);
  }
}

async function insertBulkStep(params: {
  shopId: string;
  bulkRunId: string;
  stepName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  errorMessage?: string | null;
}): Promise<void> {
  const started = Date.now();
  const isTerminal = params.status === 'completed' || params.status === 'failed';
  await withTenantContext(params.shopId, async (client) => {
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
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, 0, $4, now(), CASE WHEN $5::boolean THEN now() ELSE NULL END, $6, now(), now())`,
      [
        params.bulkRunId,
        params.shopId,
        params.stepName,
        params.status,
        isTerminal,
        params.errorMessage ?? null,
      ]
    );
  });
  recordDbQuery('insert', (Date.now() - started) / 1000);
}

async function markBulkRunFailed(params: {
  shopId: string;
  bulkRunId: string;
  errorMessage: string;
  errorType: string;
  errorCode?: string | null;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE bulk_runs
       SET status = 'failed',
           error_message = $1,
           completed_at = now(),
           updated_at = now()
       WHERE id = $2`,
      [params.errorMessage, params.bulkRunId]
    );

    await client.query(
      `INSERT INTO bulk_errors (
         bulk_run_id,
         shop_id,
         error_type,
         error_code,
         error_message,
         created_at
       )
       VALUES ($1, $2, $3, $4, $5, now())`,
      [
        params.bulkRunId,
        params.shopId,
        params.errorType,
        params.errorCode ?? null,
        params.errorMessage,
      ]
    );
  });
}

async function markBulkRunStarted(params: {
  shopId: string;
  bulkRunId: string;
  shopifyOperationId: string;
  apiVersion: string;
  costEstimate: number | null;
}): Promise<void> {
  const started = Date.now();
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE bulk_runs
       SET status = 'running',
           started_at = COALESCE(started_at, now()),
           shopify_operation_id = $1,
           api_version = $2,
           cost_estimate = COALESCE($3, cost_estimate),
           updated_at = now()
       WHERE id = $4`,
      [params.shopifyOperationId, params.apiVersion, params.costEstimate, params.bulkRunId]
    );
  });
  recordDbQuery('update', (Date.now() - started) / 1000);
}

export function startBulkOrchestratorWorker(logger: Logger): BulkOrchestratorWorkerHandle {
  const redis = new RedisCtor(env.redisUrl);
  const qmOptions = { config: configFromEnv(env) };

  const { worker, dlqQueue } = createWorker<BulkOrchestratorJobPayload>(qmOptions, {
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
              : sha256Hex(
                  `${payload.shopId}|${payload.operationType}|${payload.queryType ?? ''}|${graphqlQueryHash}`
                );

            const run = await insertOrLoadBulkRun({
              shopId: payload.shopId,
              operationType: payload.operationType,
              queryType: payload.queryType ?? null,
              idempotencyKey,
              graphqlQueryHash,
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

  const close = async (): Promise<void> => {
    await worker.close();
    await dlqQueue?.close().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  };

  return { worker, redis, close };
}
