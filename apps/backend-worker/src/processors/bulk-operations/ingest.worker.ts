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
import { recordBulkIngestProgress, setBulkBacklogBytes } from '../../otel/metrics.js';
import {
  recordBulkCopyAbortedEvent,
  recordBulkDlqEvent,
  recordBulkDownloadRetryEvent,
  recordBulkRowsQuarantinedEvent,
} from './otel/events.js';
import { withBulkSpan } from './otel/spans.js';
import {
  validateBulkIngestJobPayload,
  type BulkIngestJobPayload,
  type BulkOperationType,
} from '@app/types';
import { withTenantContext } from '@app/database';
import * as path from 'node:path';
import { mkdir, rm, stat, truncate } from 'node:fs/promises';

import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';
import { enqueueDlqDirect } from './failure-handler.js';
import { insertBulkError, insertBulkStep, loadBulkRunContext } from './state-machine.js';
import { getBulkIngestConfig } from './config.js';
import {
  runBulkStreamingPipelineWithStitching,
  runBulkStreamingPipelineWithStitchingFromFile,
} from './pipeline/index.js';
import { StagingCopyWriter } from './pipeline/stages/copy-writer.js';
import { readIngestCheckpoint, persistIngestCheckpoint } from './pipeline/checkpoint.js';
import { runMergeFromStaging } from './pipeline/stages/merge.js';
import type { PipelineCounters } from './pipeline/types.js';
import { runPimSyncFromBulkRun } from './pim/sync.js';

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
    configuredBase && configuredBase.length > 0
      ? configuredBase
      : '/var/lib/neanelu/bulk-artifacts';
  const dir = path.join(base, params.shopId, params.bulkRunId);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function preparePersistedJsonl(params: {
  jsonlPath: string;
  resumeFromBytes: number;
}): Promise<{ path: string; append: boolean } | null> {
  const resumeBytes = Math.max(0, Math.trunc(params.resumeFromBytes));
  if (resumeBytes <= 0) {
    return { path: params.jsonlPath, append: false };
  }

  const existing = await stat(params.jsonlPath).catch(() => null);
  if (!existing?.isFile()) {
    return null;
  }

  if (existing.size > resumeBytes) {
    await truncate(params.jsonlPath, resumeBytes);
  }

  if (existing.size < resumeBytes) {
    return null;
  }

  return { path: params.jsonlPath, append: true };
}

async function insertJsonlArtifact(params: {
  shopId: string;
  bulkRunId: string;
  filePath: string;
  bytesSize: number;
  rowsCount?: number | null;
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
         created_at
       )
       VALUES ($1, $2, 'shopify_bulk_result_jsonl', $3, NULL, $4, $5, now())`,
      [params.bulkRunId, params.shopId, params.filePath, params.bytesSize, params.rowsCount ?? null]
    );
  });
}

async function updateBulkRunBytesProcessed(params: {
  shopId: string;
  bulkRunId: string;
  bytesProcessed: number;
}): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    await client.query(
      `UPDATE bulk_runs
       SET bytes_processed = GREATEST(bytes_processed, $1::bigint),
           updated_at = now()
       WHERE id = $2
         AND shop_id = $3`,
      [Math.max(0, Math.trunc(params.bytesProcessed)), params.bulkRunId, params.shopId]
    );
  });
}

async function pruneOldJsonlArtifacts(params: { shopId: string; keep: number }): Promise<void> {
  await withTenantContext(params.shopId, async (client) => {
    const { rows } = await client.query<{
      bulk_run_id: string;
      file_path: string | null;
    }>(
      `SELECT bulk_run_id, file_path
       FROM bulk_artifacts
       WHERE shop_id = $1
         AND artifact_type = 'shopify_bulk_result_jsonl'
       ORDER BY created_at DESC`,
      [params.shopId]
    );

    const toDelete = rows.slice(Math.max(0, params.keep));
    if (toDelete.length === 0) return;

    const runIds = toDelete.map((row) => row.bulk_run_id);
    await client.query(
      `DELETE FROM bulk_artifacts
       WHERE shop_id = $1
         AND artifact_type = 'shopify_bulk_result_jsonl'
         AND bulk_run_id = ANY($2::uuid[])`,
      [params.shopId, runIds]
    );

    for (const row of toDelete) {
      if (!row.file_path) continue;
      await rm(row.file_path, { force: true }).catch(() => undefined);
    }
  });
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

        let copyWriter: StagingCopyWriter | null = null;

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
          const resultSizeBytes =
            typeof run.result_size_bytes === 'number' && Number.isFinite(run.result_size_bytes)
              ? Math.max(0, Math.trunc(run.result_size_bytes))
              : null;

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

          const jsonlPath = path.join(artifactsDir, 'bulk-result.jsonl');
          const persistJsonl = await preparePersistedJsonl({
            jsonlPath,
            resumeFromBytes: committedBytes,
          });
          if (!persistJsonl && committedBytes > 0) {
            logger.warn(
              {
                [OTEL_ATTR.SHOP_ID]: payload.shopId,
                bulkRunId: payload.bulkRunId,
                resumeFromBytes: committedBytes,
                jsonlPath,
              },
              'Skipping JSONL persistence because resume file is missing or smaller than resume offset'
            );
          }

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

          copyWriter = new StagingCopyWriter({
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
          const quarantineSampleIds = new Set<string>();

          const pipelineCounters: PipelineCounters = {
            bytesProcessed: 0,
            totalLines: 0,
            validLines: 0,
            invalidLines: 0,
          };

          let lastMetricsAt = Date.now();
          let lastLines = 0;
          let lastBytes = 0;
          let downloadBytes = committedBytes;

          const emitIngestMetrics = (): void => {
            const now = Date.now();
            const elapsedSeconds = Math.max(0.001, (now - lastMetricsAt) / 1000);
            const linesDelta = pipelineCounters.totalLines - lastLines;
            const bytesDelta = pipelineCounters.bytesProcessed - lastBytes;

            recordBulkIngestProgress({
              rowsDelta: linesDelta,
              bytesDelta,
              rowsPerSecond: linesDelta / elapsedSeconds,
            });

            if (resultSizeBytes != null) {
              const backlog = Math.max(0, resultSizeBytes - pipelineCounters.bytesProcessed);
              setBulkBacklogBytes(op, backlog);
            }

            lastMetricsAt = now;
            lastLines = pipelineCounters.totalLines;
            lastBytes = pipelineCounters.bytesProcessed;
          };

          let pipelineResult: Awaited<ReturnType<typeof runBulkStreamingPipelineWithStitching>>;
          try {
            pipelineResult = await withBulkSpan(
              'bulk.copy',
              {
                shopId: payload.shopId,
                bulkRunId: payload.bulkRunId,
                operationType: op,
                queryType: run.query_type ?? null,
                step: 'copy',
              },
              async () =>
                await runBulkStreamingPipelineWithStitching({
                  shopId: payload.shopId,
                  bulkRunId: payload.bulkRunId,
                  operationType: op,
                  artifactsDir,
                  logger,
                  url: payload.resultUrl,
                  persistJsonlPath: persistJsonl?.path ?? null,
                  persistJsonlAppend: persistJsonl?.append ?? false,
                  ...(committedBytes > 0 ? { resumeFromBytes: committedBytes } : {}),
                  counters: pipelineCounters,
                  tolerateInvalidLines: true,
                  parseEngine: 'stream-json',
                  downloadHighWaterMarkBytes: cfg.downloadHighWaterMarkBytes,
                  onDownloadRetry: (retry) => {
                    recordBulkDownloadRetryEvent({
                      shopId: payload.shopId,
                      bulkRunId: payload.bulkRunId,
                      attempt: retry.attempt,
                      reason: retry.reason,
                      delayMs: retry.delayMs,
                    });
                  },
                  onDownloadChunk: (chunk) => {
                    downloadBytes += chunk.bytes;
                    void updateBulkRunBytesProcessed({
                      shopId: payload.shopId,
                      bulkRunId: payload.bulkRunId,
                      bytesProcessed: downloadBytes,
                    });
                  },
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
                    if (
                      record.kind.startsWith('quarantine_') &&
                      'id' in record &&
                      typeof record.id === 'string' &&
                      quarantineSampleIds.size < 5
                    ) {
                      quarantineSampleIds.add(record.id);
                    }
                    if (!copyWriter) {
                      throw new Error('copy_writer_uninitialized');
                    }
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

                      emitIngestMetrics();
                    }
                  },
                })
            );
          } catch (error) {
            const fallbackPath = persistJsonl?.path ?? null;
            const fallbackStat = fallbackPath ? await stat(fallbackPath).catch(() => null) : null;
            if (!fallbackPath || !fallbackStat?.isFile() || fallbackStat.size <= 0) {
              throw error;
            }

            logger.warn(
              {
                [OTEL_ATTR.SHOP_ID]: payload.shopId,
                bulkRunId: payload.bulkRunId,
                fallbackPath,
                fallbackBytes: fallbackStat.size,
              },
              'Stream interrupted; falling back to local JSONL file'
            );

            pipelineResult = await withBulkSpan(
              'bulk.copy.fallback_local',
              {
                shopId: payload.shopId,
                bulkRunId: payload.bulkRunId,
                operationType: op,
                queryType: run.query_type ?? null,
                step: 'copy',
              },
              async () =>
                await runBulkStreamingPipelineWithStitchingFromFile({
                  shopId: payload.shopId,
                  bulkRunId: payload.bulkRunId,
                  operationType: op,
                  artifactsDir,
                  logger,
                  filePath: fallbackPath,
                  ...(committedBytes > 0 ? { startOffsetBytes: committedBytes } : {}),
                  counters: pipelineCounters,
                  tolerateInvalidLines: true,
                  parseEngine: 'stream-json',
                  readHighWaterMarkBytes: cfg.downloadHighWaterMarkBytes,
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
                    if (
                      record.kind.startsWith('quarantine_') &&
                      'id' in record &&
                      typeof record.id === 'string' &&
                      quarantineSampleIds.size < 5
                    ) {
                      quarantineSampleIds.add(record.id);
                    }
                    if (!copyWriter) {
                      throw new Error('copy_writer_uninitialized');
                    }
                    stitchedRecordsSeen += 1;

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
                      if ('id' in record && typeof (record as { id?: unknown }).id === 'string') {
                        lastIdSeen = (record as { id: string }).id;
                      }
                    }

                    if (stitchedRecordsSeen <= committedRecords) {
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

                      emitIngestMetrics();
                    }
                  },
                })
            );
          }

          const writer = copyWriter;
          if (!writer) {
            throw new Error('copy_writer_uninitialized');
          }
          await writer.flush();
          emitIngestMetrics();
          const counters = writer.getCounters();
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

          await withBulkSpan(
            'bulk.merge',
            {
              shopId: payload.shopId,
              bulkRunId: payload.bulkRunId,
              operationType: op,
              queryType: run.query_type ?? null,
              step: 'merge',
            },
            async () =>
              await runMergeFromStaging({
                shopId: payload.shopId,
                bulkRunId: payload.bulkRunId,
                logger,
                analyze: cfg.mergeAnalyze,
                allowDeletes: cfg.mergeAllowDeletes,
                isFullSnapshot,
                reindexStaging: cfg.stagingReindex,
              })
          );

          await insertBulkStep({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
            stepName: 'ingest.merge.completed',
            status: 'completed',
          });

          await insertBulkStep({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
            stepName: 'ingest.pim_sync.start',
            status: 'running',
          });

          await runPimSyncFromBulkRun({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
            logger,
          });

          await insertBulkStep({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
            stepName: 'ingest.pim_sync.completed',
            status: 'completed',
          });

          await insertBulkStep({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
            stepName: 'ingest.completed',
            status: 'completed',
          });

          if (persistJsonl?.path) {
            const fileInfo = await stat(persistJsonl.path).catch(() => null);
            if (fileInfo?.isFile() && fileInfo.size > 0) {
              await insertJsonlArtifact({
                shopId: payload.shopId,
                bulkRunId: payload.bulkRunId,
                filePath: persistJsonl.path,
                bytesSize: fileInfo.size,
                rowsCount: persistJsonl.append ? null : pipelineCounters.totalLines,
              });
              await pruneOldJsonlArtifacts({ shopId: payload.shopId, keep: 2 });
            }
          }

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

          const quarantinedCount =
            pipelineResult.stitching.variantsQuarantined +
            pipelineResult.stitching.metafieldsQuarantined +
            pipelineResult.stitching.inventoryLevelsQuarantined;
          if (quarantinedCount > 0) {
            recordBulkRowsQuarantinedEvent({
              shopId: payload.shopId,
              bulkRunId: payload.bulkRunId,
              count: quarantinedCount,
              sampleIds: quarantineSampleIds.size > 0 ? Array.from(quarantineSampleIds) : null,
            });
          }

          return {
            outcome: 'completed' as const,
            counters: pipelineResult.counters,
            stitching: pipelineResult.stitching,
            copy: counters,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          const counters = copyWriter?.getCounters() ?? {
            recordsSeen: 0,
            recordsSkipped: 0,
            productsBuffered: 0,
            variantsBuffered: 0,
            productsCopied: 0,
            variantsCopied: 0,
          };
          const rowsCommitted = counters.productsCopied + counters.variantsCopied;
          recordBulkCopyAbortedEvent({
            shopId: payload.shopId,
            bulkRunId: payload.bulkRunId,
            reason: message,
            rowsCommitted,
          });

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
