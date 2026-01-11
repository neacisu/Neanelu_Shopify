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
} from './state-machine.js';

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

export function startBulkOrchestratorWorker(logger: Logger): BulkOrchestratorWorkerHandle {
  const redis = new RedisCtor(env.redisUrl);
  const qmOptions = { config: configFromEnv(env) };
  const graphqlLimiterCfg = getShopifyGraphqlRateLimitConfig();

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
