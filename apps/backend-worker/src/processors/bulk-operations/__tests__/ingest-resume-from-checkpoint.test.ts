import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const pipelinePath = new URL('../pipeline/index.js', import.meta.url).href;
const copyWriterPath = new URL('../pipeline/stages/copy-writer.js', import.meta.url).href;
const mergePath = new URL('../pipeline/stages/merge.js', import.meta.url).href;
const stateMachinePath = new URL('../state-machine.js', import.meta.url).href;
const failureHandlerPath = new URL('../failure-handler.js', import.meta.url).href;

let capturedProcessor:
  | ((job: {
      id?: string | number | null;
      name?: string | null;
      data: unknown;
      updateData?: (data: unknown) => Promise<unknown>;
      attemptsMade?: number;
      stacktrace?: string[];
    }) => Promise<unknown>)
  | null = null;

let lastResumeFromBytes: number | undefined;

let mocksInstalled = false;
let loadBulkRunContextImpl:
  | (() => Promise<{
      operation_type: string;
      query_type: string | null;
      bytes_processed: number | null;
      records_processed: number | null;
      cursor_state: unknown;
    }>)
  | null = null;

beforeEach(() => {
  capturedProcessor = null;
  lastResumeFromBytes = undefined;
});

async function installBaseMocks(params: {
  loadBulkRunContext: () => Promise<{
    operation_type: string;
    query_type: string | null;
    bytes_processed: number | null;
    records_processed: number | null;
    cursor_state: unknown;
  }>;
}): Promise<void> {
  loadBulkRunContextImpl = params.loadBulkRunContext;
  if (mocksInstalled) return;

  await Promise.resolve(
    mock.module('@app/config', {
      namedExports: {
        loadEnv: () => ({
          redisUrl: 'redis://localhost:6379/0',
          encryptionKeyHex: '00'.repeat(32),
          bullmqProToken: 'test',
          maxActivePerShop: 2,
          maxGlobalConcurrency: 50,
          starvationTimeoutMs: 60_000,
          // Plan F5.2.8 knobs
          maxConcurrentDownloads: 2,
          maxConcurrentCopies: 2,
          maxGlobalIngestion: 10,
          // PR-042 ingest knobs
          bulkCopyBatchRows: 10_000,
          bulkCopyBatchBytes: 1024 * 1024,
          bulkDownloadHighWaterMarkBytes: 64 * 1024,
          bulkMergeAnalyze: false,
          bulkMergeAllowDeletes: false,
          bulkStagingReindex: false,
        }),
      },
    })
  );

  await Promise.resolve(
    mock.module('@app/types', {
      namedExports: {
        validateBulkIngestJobPayload: () => true,
      },
    })
  );

  await Promise.resolve(
    mock.module('@app/database', {
      namedExports: {
        withTenantContext: async (
          _shopId: string,
          fn: (client: { query: () => Promise<unknown> }) => Promise<unknown>
        ) => {
          return await fn({ query: () => Promise.resolve({ rows: [] }) });
        },
      },
    })
  );

  await Promise.resolve(
    mock.module('@app/queue-manager', {
      namedExports: {
        BULK_INGEST_QUEUE_NAME: 'bulk-ingest-queue',
        enqueueBulkOrchestratorJob: () => Promise.resolve(undefined),
        configFromEnv: (_env: unknown) => ({ connection: { url: 'redis://localhost:6379/0' } }),
        withJobTelemetryContext: async (_job: unknown, fn: () => Promise<unknown>) => fn(),
        enqueueDlqEntry: () => Promise.resolve(undefined),
        createWorker: (
          _qmOptions: unknown,
          worker: { processor: (job: unknown) => Promise<unknown> }
        ) => {
          capturedProcessor = worker.processor as typeof capturedProcessor;
          return {
            worker: { on: () => undefined, close: () => Promise.resolve(undefined) },
            dlqQueue: { close: () => Promise.resolve(undefined) },
          };
        },
      },
    })
  );

  await Promise.resolve(
    mock.module(copyWriterPath, {
      namedExports: {
        StagingCopyWriter: class FakeCopyWriter {
          handleRecord(): Promise<{ flushed: boolean }> {
            return Promise.resolve({ flushed: false });
          }
          flush(): Promise<void> {
            return Promise.resolve();
          }
          getCounters() {
            return {
              recordsSeen: 0,
              recordsSkipped: 0,
              productsBuffered: 0,
              variantsBuffered: 0,
              productsCopied: 0,
              variantsCopied: 0,
            };
          }
        },
      },
    })
  );

  await Promise.resolve(
    mock.module(failureHandlerPath, {
      namedExports: {
        enqueueDlqDirect: () => Promise.resolve(undefined),
      },
    })
  );

  await Promise.resolve(
    mock.module(mergePath, {
      namedExports: {
        runMergeFromStaging: (_params?: { reindexStaging?: boolean }) => Promise.resolve(undefined),
      },
    })
  );

  await Promise.resolve(
    mock.module(pipelinePath, {
      namedExports: {
        runBulkStreamingPipelineWithStitching: (p: { resumeFromBytes?: number }) => {
          lastResumeFromBytes = p.resumeFromBytes;
          return Promise.resolve({
            counters: { bytesProcessed: 0, totalLines: 0, validLines: 0, invalidLines: 0 },
            stitching: {
              productsSeen: 0,
              variantsSeen: 0,
              variantsEmitted: 0,
              variantsBufferedInMemory: 0,
              variantsSpilledToDisk: 0,
              variantsQuarantined: 0,
              metafieldsSeen: 0,
              metafieldsEmitted: 0,
              metafieldsSpilledToDisk: 0,
              metafieldsQuarantined: 0,
              inventoryItemsSeen: 0,
              inventoryLevelsSeen: 0,
              inventoryLevelsEmitted: 0,
              inventoryLevelsSpilledToDisk: 0,
              inventoryLevelsQuarantined: 0,
            },
          });
        },
        runBulkStreamingPipelineWithStitchingFromFile: () =>
          Promise.resolve({
            counters: { bytesProcessed: 0, totalLines: 0, validLines: 0, invalidLines: 0 },
            stitching: {
              productsSeen: 0,
              variantsSeen: 0,
              variantsEmitted: 0,
              variantsBufferedInMemory: 0,
              variantsSpilledToDisk: 0,
              variantsQuarantined: 0,
              metafieldsSeen: 0,
              metafieldsEmitted: 0,
              metafieldsSpilledToDisk: 0,
              metafieldsQuarantined: 0,
              inventoryItemsSeen: 0,
              inventoryLevelsSeen: 0,
              inventoryLevelsEmitted: 0,
              inventoryLevelsSpilledToDisk: 0,
              inventoryLevelsQuarantined: 0,
            },
          }),
      },
    })
  );

  await Promise.resolve(
    mock.module(stateMachinePath, {
      namedExports: {
        insertBulkStep: () => Promise.resolve(undefined),
        insertBulkError: () => Promise.resolve(undefined),
        loadBulkRunContext: () => {
          if (!loadBulkRunContextImpl) {
            return Promise.reject(new Error('loadBulkRunContextImpl not set'));
          }
          return loadBulkRunContextImpl();
        },
      },
    })
  );

  mocksInstalled = true;
}

void describe('ingest: resume from checkpoint bytes', () => {
  void it('passes resumeFromBytes from ingest checkpoint v2', async () => {
    const committedBytes = 42;

    await installBaseMocks({
      loadBulkRunContext: () =>
        Promise.resolve({
          operation_type: 'PRODUCTS_EXPORT',
          query_type: 'core',
          bytes_processed: committedBytes,
          records_processed: 123,
          cursor_state: {
            ingest: {
              checkpoint: {
                version: 2,
                committedRecords: 10,
                committedProducts: 10,
                committedVariants: 0,
                committedBytes,
                committedLines: 20,
                lastSuccessfulId: 'gid://shopify/Product/1',
                lastCommitAtIso: new Date().toISOString(),
                isFullSnapshot: true,
              },
            },
          },
        }),
    });

    const { startBulkIngestWorker } = await import('../ingest.worker.js');

    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      fatal: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
    };

    const handle = startBulkIngestWorker(logger as never);
    assert.ok(handle);
    assert.ok(capturedProcessor, 'expected createWorker mock to capture ingest processor');

    await capturedProcessor({
      id: 'job-1',
      name: 'bulk.ingest',
      data: {
        shopId: randomUUID(),
        bulkRunId: randomUUID(),
        resultUrl: 'https://shopify.example/bulk/result.jsonl',
        triggeredBy: 'system',
        requestedAt: Date.now(),
      },
    });

    assert.equal(lastResumeFromBytes, committedBytes);

    await handle.close();
  });

  void it('falls back to bulk_runs.bytes_processed when checkpoint is v1', async () => {
    const bytesProcessed = 99;

    await installBaseMocks({
      loadBulkRunContext: () =>
        Promise.resolve({
          operation_type: 'PRODUCTS_EXPORT',
          query_type: 'core',
          bytes_processed: bytesProcessed,
          records_processed: 5,
          cursor_state: {
            ingest: {
              checkpoint: {
                version: 1,
                committedRecords: 1,
                committedProducts: 1,
                committedVariants: 0,
                lastCommitAtIso: new Date().toISOString(),
                isFullSnapshot: true,
              },
            },
          },
        }),
    });

    const { startBulkIngestWorker } = await import('../ingest.worker.js');

    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      fatal: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
    };

    const handle = startBulkIngestWorker(logger as never);
    assert.ok(handle);
    assert.ok(capturedProcessor, 'expected createWorker mock to capture ingest processor');

    await capturedProcessor({
      id: 'job-2',
      name: 'bulk.ingest',
      data: {
        shopId: randomUUID(),
        bulkRunId: randomUUID(),
        resultUrl: 'https://shopify.example/bulk/result.jsonl',
        triggeredBy: 'system',
        requestedAt: Date.now(),
      },
    });

    assert.equal(lastResumeFromBytes, bytesProcessed);

    await handle.close();
  });
});
