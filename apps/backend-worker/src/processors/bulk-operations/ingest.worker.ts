import {
  BULK_INGEST_QUEUE_NAME,
  createWorker,
  withJobTelemetryContext,
  configFromEnv,
  type DlqEntry,
  type DlqQueueLike,
} from '@app/queue-manager';
import { loadEnv } from '@app/config';
import { OTEL_ATTR, type Logger } from '@app/logger';
import {
  validateBulkIngestJobPayload,
  type BulkIngestJobPayload,
  type BulkOperationType,
} from '@app/types';
import { withTenantContext } from '@app/database';
import * as path from 'node:path';
import { mkdir } from 'node:fs/promises';

import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';
import { enqueueDlqDirect } from './failure-handler.js';
import { insertBulkError, insertBulkStep, loadBulkRunContext } from './state-machine.js';
import { getBulkIngestConfig } from './config.js';
import { runBulkStreamingPipelineWithStitching } from './pipeline/index.js';
import { StagingCopyWriter } from './pipeline/stages/copy-writer.js';
import { readIngestCheckpoint, persistIngestCheckpoint } from './pipeline/checkpoint.js';
import { runMergeFromStaging } from './pipeline/stages/merge.js';
import type { PipelineCounters } from './pipeline/types.js';

const env = loadEnv();

function safeJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

async function ensureBulkIngestArtifactsDir(params: {
  shopId: string;
  bulkRunId: string;
}): Promise<string> {
  const configuredBase = process.env['BULK_INGEST_ARTIFACTS_DIR']?.trim();
  const base =
    configuredBase && configuredBase.length > 0 ? configuredBase : '/tmp/neanelu-bulk-ingest';
  const dir = path.join(base, params.shopId, params.bulkRunId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export interface BulkIngestWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
}

export function startBulkIngestWorker(logger: Logger): BulkIngestWorkerHandle {
  const cfg = getBulkIngestConfig();
  const qmOptions = { config: configFromEnv(env) };

  let dlqQueueRef: DlqQueueLike | null = null;

  const created = createWorker<BulkIngestJobPayload>(qmOptions, {
    name: BULK_INGEST_QUEUE_NAME,
    enableDelayHandling: false,
    enableDlq: true,
    workerOptions: {
      concurrency: Math.max(
        1,
        Math.min(env.maxGlobalIngestion, env.maxConcurrentDownloads, env.maxConcurrentCopies)
      ),
      group: { concurrency: env.maxActivePerShop },
    },
    processor: async (job) => {
      return await withJobTelemetryContext(job, async () => {
        const jobId = String(job.id ?? job.name);
        const payloadUnknown: unknown = job.data;
        if (!validateBulkIngestJobPayload(payloadUnknown)) {
          logger.warn(
            { event: 'job.drop', jobId: job.id, name: job.name, queueName: BULK_INGEST_QUEUE_NAME },
            'Bulk ingest job payload failed validation (dropping)'
          );
          return;
        }

        const payload = payloadUnknown;

        setWorkerCurrentJob('bulk-ingest-worker', {
          jobId,
          jobName: String(job.name),
          startedAtIso: new Date().toISOString(),
          progressPct: null,
        });

        try {
          await insertBulkStep({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
            stepName: 'ingest.start',
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
              errorType: 'ingest_missing_run',
              errorCode: 'MISSING_RUN',
              errorMessage: 'bulk_run not found for ingest job',
            });
            return;
          }

          // PR-042 scope: only PRODUCTS_EXPORT ingestion.
          const op = run.operation_type as BulkOperationType;
          if (op !== 'PRODUCTS_EXPORT') {
            await insertBulkStep({
              shopId: payload.shopId,
              bulkRunId: payload.bulkRunId,
              stepName: 'ingest.skip_unsupported_operation',
              status: 'completed',
              errorMessage: `Unsupported operation_type for ingest: ${String(run.operation_type)}`,
            });
            return;
          }

          const artifactsDir = await ensureBulkIngestArtifactsDir({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
          });

          // Determine full snapshot boundary (for deletes): core products export only.
          const isFullSnapshot = run.query_type === 'core';

          const cursor = safeJsonObject(run.cursor_state);
          const prevCheckpoint = readIngestCheckpoint(cursor);
          const committedRecords = prevCheckpoint?.committedRecords ?? 0;
          const committedBytes =
            prevCheckpoint?.version === 2
              ? prevCheckpoint.committedBytes
              : Math.max(0, Math.trunc(run.bytes_processed ?? 0));
          const committedLines =
            prevCheckpoint?.version === 2
              ? prevCheckpoint.committedLines
              : Math.max(0, Math.trunc(run.records_processed ?? 0));
          const lastSuccessfulId =
            prevCheckpoint?.version === 2 ? prevCheckpoint.lastSuccessfulId : null;

          // Clean staging for fresh ingest.
          if (!prevCheckpoint || committedRecords <= 0) {
            await withTenantContext(payload.shopId, async (client) => {
              await client.query('DELETE FROM staging_variants WHERE bulk_run_id = $1', [
                payload.bulkRunId,
              ]);
              await client.query('DELETE FROM staging_products WHERE bulk_run_id = $1', [
                payload.bulkRunId,
              ]);
            });
          }

          const copyWriter = new StagingCopyWriter({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
            batchMaxRows: cfg.copyBatchRows,
            batchMaxBytes: cfg.copyBatchBytes,
          });

          let stitchedRecordsSeen = 0;
          let productsCommitted = prevCheckpoint?.committedProducts ?? 0;
          let variantsCommitted = prevCheckpoint?.committedVariants ?? 0;
          let committedBytesSeen = committedBytes;
          let committedLinesSeen = committedLines;
          let lastIdSeen: string | null = lastSuccessfulId;

          const pipelineCounters: PipelineCounters = {
            bytesProcessed: 0,
            totalLines: 0,
            validLines: 0,
            invalidLines: 0,
          };

          const pipelineResult = await runBulkStreamingPipelineWithStitching({
            shopId: payload.shopId,
            artifactsDir,
            logger,
            url: payload.resultUrl,
            ...(committedBytes > 0 ? { resumeFromBytes: committedBytes } : {}),
            counters: pipelineCounters,
            tolerateInvalidLines: true,
            parseEngine: 'stream-json',
            downloadHighWaterMarkBytes: cfg.downloadHighWaterMarkBytes,
            onParseIssue: (issue) => {
              void insertBulkError({
                shopId: payload.shopId,
                bulkRunId: payload.bulkRunId,
                lineNumber: issue.lineNumber,
                errorType: 'ingest_parse_issue',
                errorCode: issue.kind,
                errorMessage: issue.message,
              }).catch(() => undefined);
            },
            onRecord: async (record) => {
              stitchedRecordsSeen += 1;

              // Best-effort last successful identifier (plan requirement).
              if (
                record.kind === 'product' ||
                record.kind === 'variant' ||
                record.kind === 'inventory_item' ||
                record.kind === 'inventory_level'
              ) {
                lastIdSeen = record.id;
              } else if (
                record.kind === 'product_metafields_patch' ||
                record.kind === 'variant_metafields_patch'
              ) {
                lastIdSeen = record.ownerId;
              } else {
                // quarantine_* and other records still have an id
                if ('id' in record && typeof (record as { id?: unknown }).id === 'string') {
                  lastIdSeen = (record as { id: string }).id;
                }
              }

              if (stitchedRecordsSeen <= committedRecords) {
                // Resume: skip already committed stitched records.
                return;
              }

              const { flushed } = await copyWriter.handleRecord(record);

              if (flushed) {
                const counters = copyWriter.getCounters();
                productsCommitted = counters.productsCopied;
                variantsCommitted = counters.variantsCopied;

                committedBytesSeen = pipelineCounters.bytesProcessed;
                committedLinesSeen = pipelineCounters.totalLines;

                await persistIngestCheckpoint({
                  shopId: payload.shopId,
                  bulkRunId: payload.bulkRunId,
                  recordsProcessed: stitchedRecordsSeen,
                  bytesProcessed: pipelineCounters.bytesProcessed,
                  checkpoint: {
                    version: 2,
                    committedRecords: stitchedRecordsSeen,
                    committedProducts: productsCommitted,
                    committedVariants: variantsCommitted,
                    committedBytes: committedBytesSeen,
                    committedLines: committedLinesSeen,
                    lastSuccessfulId: lastIdSeen,
                    lastCommitAtIso: new Date().toISOString(),
                    isFullSnapshot,
                  },
                });
              }
            },
          });

          await copyWriter.flush();
          const counters = copyWriter.getCounters();
          productsCommitted = counters.productsCopied;
          variantsCommitted = counters.variantsCopied;

          await persistIngestCheckpoint({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
            recordsProcessed: stitchedRecordsSeen,
            bytesProcessed: pipelineCounters.bytesProcessed,
            checkpoint: {
              version: 2,
              committedRecords: stitchedRecordsSeen,
              committedProducts: productsCommitted,
              committedVariants: variantsCommitted,
              committedBytes: pipelineCounters.bytesProcessed,
              committedLines: pipelineCounters.totalLines,
              lastSuccessfulId: lastIdSeen,
              lastCommitAtIso: new Date().toISOString(),
              isFullSnapshot,
            },
          });

          await insertBulkStep({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
            stepName: 'ingest.copy.completed',
            status: 'completed',
            errorMessage: null,
          });

          await runMergeFromStaging({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
            logger,
            analyze: cfg.mergeAnalyze,
            allowDeletes: cfg.mergeAllowDeletes,
            isFullSnapshot,
          });

          await insertBulkStep({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
            stepName: 'ingest.merge.completed',
            status: 'completed',
          });

          await insertBulkStep({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
            stepName: 'ingest.completed',
            status: 'completed',
          });

          logger.info(
            {
              [OTEL_ATTR.SHOP_ID]: payload.shopId,
              bulkRunId: payload.bulkRunId,
              counters: pipelineResult.counters,
              stitching: pipelineResult.stitching,
              copy: counters,
            },
            'Bulk ingest completed'
          );

          return {
            outcome: 'completed' as const,
            counters: pipelineResult.counters,
            stitching: pipelineResult.stitching,
            copy: counters,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          await insertBulkError({
            shopId:
              (job.data as { shopId?: string } | null | undefined)?.shopId ??
              '00000000-0000-0000-0000-000000000000',
            bulkRunId:
              (job.data as { bulkRunId?: string } | null | undefined)?.bulkRunId ??
              '00000000-0000-0000-0000-000000000000',
            errorType: 'ingest_failed',
            errorCode: 'INGEST_FAILED',
            errorMessage: message,
          }).catch(() => undefined);

          try {
            const entry: DlqEntry = {
              originalQueue: BULK_INGEST_QUEUE_NAME,
              originalJobId: job?.id != null ? String(job.id) : null,
              originalJobName: String(job?.name ?? 'bulk.ingest'),
              attemptsMade: job?.attemptsMade ?? 0,
              failedReason: message,
              stacktrace: job?.stacktrace ?? [],
              data: {
                originalJob: {
                  queue: BULK_INGEST_QUEUE_NAME,
                  id: job?.id != null ? String(job.id) : null,
                  name: String(job?.name ?? 'bulk.ingest'),
                  data: job?.data,
                },
                lastError: { message },
              },
              occurredAt: new Date().toISOString(),
            };
            await enqueueDlqDirect({ dlqQueue: dlqQueueRef, entry });
          } catch {
            // best-effort
          }

          throw error;
        } finally {
          clearWorkerCurrentJob('bulk-ingest-worker', String(job.id ?? job.name));
        }
      });
    },
  });

  const { worker, dlqQueue } = created;
  dlqQueueRef = (dlqQueue as DlqQueueLike | null | undefined) ?? null;

  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, err }, 'Bulk ingest job failed');
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'Bulk ingest worker error');
  });

  const close = async (): Promise<void> => {
    await worker.close();
    await dlqQueue?.close().catch(() => undefined);
  };

  return { worker, close };
}
