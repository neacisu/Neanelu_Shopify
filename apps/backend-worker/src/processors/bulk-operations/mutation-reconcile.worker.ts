import { loadEnv } from '@app/config';
import { withTenantContext } from '@app/database';
import { OTEL_ATTR, type Logger } from '@app/logger';
import {
  BULK_MUTATION_RECONCILE_QUEUE_NAME,
  createWorker,
  withJobTelemetryContext,
  configFromEnv,
  type DlqQueueLike,
  type DlqEntry,
} from '@app/queue-manager';
import {
  validateBulkMutationReconcileJobPayload,
  type BulkMutationReconcileJobPayload,
  type BulkOperationType,
} from '@app/types';
import { Readable } from 'node:stream';
import * as readline from 'node:readline';
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';
import { enqueueDlqDirect } from './failure-handler.js';
import { recordBulkDlqEvent } from './otel/events.js';
import {
  insertBulkError,
  insertBulkStep,
  loadBulkRunContext,
  patchBulkRunCursorState,
} from './state-machine.js';
import { ensureBulkMutationArtifactsDir } from './mutations/artifacts-dir.js';
import { filterJsonlByLineNumbers } from './mutations/filter-jsonl-by-line-numbers.js';
import {
  getBulkMutationContract,
  type BulkMutationType,
  type BulkMutationVersion,
} from './mutations/index.js';
import { classifyBulkMutationResultLineFailure } from './mutations/requeue-policy.js';
import { enqueueBulkOrchestratorJob } from '@app/queue-manager';

const env = loadEnv();

async function insertArtifact(params: {
  shopId: string;
  bulkRunId: string;
  artifactType: string;
  filePath: string;
  url?: string | null;
  bytesSize?: number | null;
  rowsCount?: number | null;
  checksum?: string | null;
  expiresAt?: Date | null;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `INSERT INTO bulk_artifacts (
         bulk_run_id,
         shop_id,
         artifact_type,
         file_path,
         url,
         bytes_size,
         rows_count,
         checksum,
         expires_at,
         created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
      [
        params.bulkRunId,
        params.shopId,
        params.artifactType,
        params.filePath,
        params.url ?? null,
        params.bytesSize ?? null,
        params.rowsCount ?? null,
        params.checksum ?? null,
        params.expiresAt ? params.expiresAt.toISOString() : null,
      ]
    );
  });
}

function safeJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
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

function extractUserErrors(lineObj: Record<string, unknown>, mutationType: string): unknown[] {
  const data = safeJsonObject(lineObj['data']);
  const root = data ? safeJsonObject(data[mutationType]) : null;
  const userErrors = root ? root['userErrors'] : null;
  return Array.isArray(userErrors) ? userErrors : [];
}

function extractGraphqlErrors(lineObj: Record<string, unknown>): unknown[] {
  const errs = lineObj['errors'];
  return Array.isArray(errs) ? errs : [];
}

export interface BulkMutationReconcileWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
}

export function startBulkMutationReconcileWorker(
  logger: Logger
): BulkMutationReconcileWorkerHandle {
  const qmOptions = { config: configFromEnv(env) };

  let dlqQueueRef: DlqQueueLike | null = null;

  const created = createWorker<BulkMutationReconcileJobPayload>(qmOptions, {
    name: BULK_MUTATION_RECONCILE_QUEUE_NAME,
    enableDelayHandling: false,
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
        if (!validateBulkMutationReconcileJobPayload(payloadUnknown)) {
          logger.warn(
            {
              event: 'job.drop',
              jobId: job.id,
              name: job.name,
              queueName: BULK_MUTATION_RECONCILE_QUEUE_NAME,
            },
            'Bulk mutation reconcile job payload failed validation (dropping)'
          );
          return;
        }

        const payload = payloadUnknown;

        setWorkerCurrentJob('bulk-mutation-reconcile-worker', {
          jobId,
          jobName: String(job.name),
          startedAtIso: new Date().toISOString(),
          progressPct: null,
        });

        try {
          await insertBulkStep({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
            stepName: 'mutation.reconcile.start',
            status: 'running',
          });

          const run = await loadBulkRunContext({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
          });
          if (!run) {
            await insertBulkError({
              shopId: payload.shopId,
              bulkRunId: payload.bulkRunId,
              errorType: 'mutation_reconcile_missing_run',
              errorCode: 'MISSING_RUN',
              errorMessage: 'bulk_run not found for reconcile job',
            });
            return;
          }

          const cursor = safeJsonObject(run.cursor_state);
          const mutationContractState = cursor
            ? safeJsonObject(cursor['bulkMutationContract'])
            : null;
          if (!mutationContractState) {
            // Not a mutation run; nothing to do.
            await insertBulkStep({
              shopId: payload.shopId,
              bulkRunId: payload.bulkRunId,
              stepName: 'mutation.reconcile.skip_not_mutation',
              status: 'completed',
            });
            return;
          }

          const mutationTypeRaw = mutationContractState['mutationType'];
          const mutationType =
            typeof mutationTypeRaw === 'string'
              ? mutationTypeRaw
              : typeof run.query_type === 'string'
                ? run.query_type
                : '';
          const mutationVersion = (mutationContractState['version'] ??
            null) as BulkMutationVersion | null;
          const retryAttemptRaw = mutationContractState['retryAttempt'];
          const retryAttempt =
            typeof retryAttemptRaw === 'number' && Number.isFinite(retryAttemptRaw)
              ? Math.max(0, Math.trunc(retryAttemptRaw))
              : 0;

          const input = safeJsonObject(mutationContractState['input']);
          const inputPath = typeof input?.['path'] === 'string' ? input['path'] : null;

          const contract = getBulkMutationContract({
            operationType: run.operation_type as BulkOperationType,
            mutationType: mutationType as BulkMutationType,
            ...(typeof mutationVersion === 'string' ? { version: mutationVersion } : {}),
          });

          logger.info(
            {
              [OTEL_ATTR.SHOP_ID]: payload.shopId,
              jobId,
              bulkRunId: payload.bulkRunId,
              mutationType: contract.mutationType,
              retryAttempt,
            },
            'Reconciling bulk mutation results'
          );

          const res = await fetch(payload.resultUrl);
          if (!res.ok) {
            await insertBulkError({
              shopId: payload.shopId,
              bulkRunId: payload.bulkRunId,
              errorType: 'mutation_reconcile_fetch_failed',
              errorCode: `HTTP_${res.status}`,
              errorMessage: `Failed to fetch bulk mutation result: HTTP ${res.status}`,
              payload: { url: payload.resultUrl },
            });
            return;
          }
          if (!res.body) {
            await insertBulkError({
              shopId: payload.shopId,
              bulkRunId: payload.bulkRunId,
              errorType: 'mutation_reconcile_empty_body',
              errorCode: 'EMPTY_BODY',
              errorMessage: 'Bulk mutation result response had no body',
              payload: { url: payload.resultUrl },
            });
            return;
          }

          const rl = readline.createInterface({
            input: Readable.fromWeb(res.body as unknown as globalThis.ReadableStream<Uint8Array>),
            crlfDelay: Infinity,
          });

          let lineNumber = 0;
          let processed = 0;
          let errorLines = 0;
          let recoverableErrorLines = 0;
          const failedLineNumbers = new Set<number>();
          const recoverableFailedLineNumbers = new Set<number>();

          for await (const rawLine of rl) {
            lineNumber += 1;
            const line = String(rawLine).trim();
            if (!line) continue;

            processed += 1;

            let obj: unknown;
            try {
              obj = JSON.parse(line);
            } catch (err) {
              failedLineNumbers.add(lineNumber);
              // Parse errors are treated as permanent: do not requeue.
              errorLines += 1;
              await insertBulkError({
                shopId: payload.shopId,
                bulkRunId: payload.bulkRunId,
                lineNumber,
                errorType: 'mutation_result_parse_error',
                errorCode: 'JSON_PARSE',
                errorMessage: err instanceof Error ? err.message : 'Failed to parse JSON line',
              });
              continue;
            }

            const lineObj = safeJsonObject(obj);
            if (!lineObj) continue;

            const gqlErrors = extractGraphqlErrors(lineObj);
            const userErrors = extractUserErrors(lineObj, contract.mutationType);

            if (gqlErrors.length === 0 && userErrors.length === 0) continue;

            const decision = classifyBulkMutationResultLineFailure({
              graphqlErrors: gqlErrors,
              userErrors,
            });

            failedLineNumbers.add(lineNumber);
            errorLines += 1;

            if (decision.classification === 'recoverable') {
              recoverableFailedLineNumbers.add(lineNumber);
              recoverableErrorLines += 1;
            }

            if (gqlErrors.length > 0) {
              await insertBulkError({
                shopId: payload.shopId,
                bulkRunId: payload.bulkRunId,
                lineNumber,
                errorType: 'shopify_graphql_error',
                errorCode: 'GRAPHQL_ERROR',
                errorMessage: 'Shopify GraphQL error in bulk mutation result',
                payload: { errors: gqlErrors },
              });
            }

            if (userErrors.length > 0) {
              // Store as a single bulk_errors row per line (keeps volume bounded).
              await insertBulkError({
                shopId: payload.shopId,
                bulkRunId: payload.bulkRunId,
                lineNumber,
                errorType: 'shopify_user_error',
                errorCode: 'USER_ERROR',
                errorMessage: 'Shopify userErrors in bulk mutation result',
                payload: { userErrors },
              });
            }
          }

          const reportDir = await ensureBulkMutationArtifactsDir({
            shopId: payload.shopId,
            purpose: 'reports',
          });
          const reportPath = path.join(
            reportDir,
            `bulk.mutation.${payload.bulkRunId}.reconcile.json`
          );

          const report = {
            bulkRunId: payload.bulkRunId,
            shopId: payload.shopId,
            mutationType: contract.mutationType,
            mutationVersion: contract.version,
            retryAttempt,
            resultUrl: payload.resultUrl,
            processed,
            errorLines,
            recoverableErrorLines,
            failedLineNumbers: Array.from(failedLineNumbers).slice(0, 5_000),
            truncated: failedLineNumbers.size > 5_000,
            recoverableFailedLineNumbers: Array.from(recoverableFailedLineNumbers).slice(0, 5_000),
            recoverableTruncated: recoverableFailedLineNumbers.size > 5_000,
            generatedAt: new Date().toISOString(),
          };

          await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
          await insertArtifact({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
            artifactType: 'mutation_reconcile_report',
            filePath: reportPath,
          }).catch(() => undefined);

          await patchBulkRunCursorState({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
            patch: {
              bulkMutationReconcile: {
                processed,
                errorLines,
                recoverableErrorLines,
                failedLines: failedLineNumbers.size,
                recoverableFailedLines: recoverableFailedLineNumbers.size,
                reportPath,
                reconciledAt: new Date().toISOString(),
              },
            },
          });

          // Selective requeue (bounded).
          const MAX_REQUEUE_ATTEMPTS = 2;
          if (
            recoverableFailedLineNumbers.size > 0 &&
            retryAttempt < MAX_REQUEUE_ATTEMPTS &&
            inputPath
          ) {
            const requeueDir = await ensureBulkMutationArtifactsDir({
              shopId: payload.shopId,
              purpose: 'requeue',
            });
            const outputName = `bulk.mutation.${payload.bulkRunId}.requeue-attempt-${retryAttempt + 1}.jsonl`;

            const filtered = await filterJsonlByLineNumbers({
              inputPath,
              outputDir: requeueDir,
              outputName,
              includeLines: recoverableFailedLineNumbers,
            });

            await insertArtifact({
              shopId: payload.shopId,
              bulkRunId: payload.bulkRunId,
              artifactType: 'mutation_requeue_input',
              filePath: filtered.filePath,
              bytesSize: filtered.bytes,
              rowsCount: filtered.rows,
              checksum: filtered.sha256,
            }).catch(() => undefined);

            const nextIdempotencyKey = run.idempotency_key
              ? `${run.idempotency_key}__requeue_${retryAttempt + 1}`
              : `${payload.bulkRunId}__requeue_${retryAttempt + 1}`;

            await enqueueBulkOrchestratorJob({
              shopId: payload.shopId,
              operationType: contract.operationType,
              mutationType: contract.mutationType,
              mutationVersion: contract.version,
              graphqlMutation: contract.graphqlMutation,
              inputPath: filtered.filePath,
              inputChecksum: filtered.sha256,
              inputBytes: filtered.bytes,
              inputRows: filtered.rows,
              retryAttempt: retryAttempt + 1,
              idempotencyKey: nextIdempotencyKey,
              triggeredBy: payload.triggeredBy,
              requestedAt: Date.now(),
            });

            await patchBulkRunCursorState({
              shopId: payload.shopId,
              bulkRunId: payload.bulkRunId,
              patch: {
                bulkMutationRequeue: {
                  enqueuedAt: new Date().toISOString(),
                  attempt: retryAttempt + 1,
                  idempotencyKey: nextIdempotencyKey,
                  inputPath: filtered.filePath,
                  rows: filtered.rows,
                },
              },
            });

            await insertBulkStep({
              shopId: payload.shopId,
              bulkRunId: payload.bulkRunId,
              stepName: 'mutation.requeue.enqueued',
              status: 'completed',
            });
          }

          await insertBulkStep({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
            stepName: 'mutation.reconcile.completed',
            status: 'completed',
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          await insertBulkError({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
            errorType: 'mutation_reconcile_failed',
            errorCode: 'RECONCILE_FAILED',
            errorMessage: message,
          }).catch(() => undefined);

          try {
            const entry: DlqEntry = {
              originalQueue: BULK_MUTATION_RECONCILE_QUEUE_NAME,
              originalJobId: job?.id != null ? String(job.id) : null,
              originalJobName: String(job?.name ?? 'bulk.mutation.reconcile'),
              attemptsMade: job?.attemptsMade ?? 0,
              failedReason: message,
              stacktrace: job?.stacktrace ?? [],
              data: {
                originalJob: {
                  queue: BULK_MUTATION_RECONCILE_QUEUE_NAME,
                  id: job?.id != null ? String(job.id) : null,
                  name: String(job?.name ?? 'bulk.mutation.reconcile'),
                  data: job?.data,
                },
                lastError: { message },
              },
              occurredAt: new Date().toISOString(),
            };
            recordBulkDlqEvent({
              shopId: payload.shopId,
              bulkRunId: payload.bulkRunId,
              queueName: entry.originalQueue,
              jobName: entry.originalJobName,
              jobId: entry.originalJobId,
            });
            await enqueueDlqDirect({ dlqQueue: dlqQueueRef, entry });
          } catch {
            // best-effort
          }

          throw error;
        } finally {
          clearWorkerCurrentJob('bulk-mutation-reconcile-worker', jobId);
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
    logger.warn({ jobId: job?.id, err }, 'Mutation reconcile job failed');
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'Bulk mutation reconcile worker error');
  });

  const close = async (): Promise<void> => {
    await worker.close();
    await dlqQueue?.close().catch(() => undefined);
  };

  return { worker, close };
}
