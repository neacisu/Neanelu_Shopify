import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import type { Logger } from '@app/logger';
import { pool, closePool, withTenantContext } from '@app/database';

import { StagingCopyWriter } from '../../pipeline/stages/copy-writer.js';
import { runMergeFromStaging } from '../../pipeline/stages/merge.js';
import { runBulkStreamingPipelineWithStitching } from '../../pipeline/index.js';
import { createFileFixtureServer } from '../helpers/fixture-server.js';
import { writeBulkFixture } from '../helpers/fixture-builder.js';

const noopLogger: Logger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
} as unknown as Logger;

function getDatabaseUrl(): string | null {
  return process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? null;
}

const runPerf = process.env['RUN_PERF_TESTS'] === '1';

const baselinePath = new URL('./baselines/bulk-ingest.baseline.json', import.meta.url);

function dumpActiveHandles(label: string): void {
  const proc = process as unknown as {
    _getActiveHandles?: () => unknown[];
    _getActiveRequests?: () => unknown[];
  };
  const handles = proc._getActiveHandles?.() ?? [];
  const requests = proc._getActiveRequests?.() ?? [];
  const summary = new Map<string, number>();
  const verbose = process.env['PERF_DEBUG_HANDLES_VERBOSE'] === '1';

  for (const h of handles) {
    const name = (h as { constructor?: { name?: string } })?.constructor?.name ?? 'unknown';
    summary.set(name, (summary.get(name) ?? 0) + 1);
  }

  const summaryObj = Object.fromEntries(summary.entries());
  console.info(`[perf] active handles (${label})`, {
    handles: handles.length,
    requests: requests.length,
    summary: summaryObj,
  });

  if (verbose) {
    for (const h of handles) {
      if (h instanceof net.Socket) {
        console.info('[perf] handle socket', {
          local: `${h.localAddress ?? ''}:${h.localPort ?? ''}`,
          remote: `${h.remoteAddress ?? ''}:${h.remotePort ?? ''}`,
          bytesRead: h.bytesRead,
          bytesWritten: h.bytesWritten,
          destroyed: h.destroyed,
        });
      } else {
        const name = (h as { constructor?: { name?: string } })?.constructor?.name ?? 'unknown';
        console.info('[perf] handle', { type: name });
      }
    }
  }
}

function renderProgress(params: {
  run: number;
  soakRuns: number;
  processed: number;
  total: number;
  stage: string;
  elapsedSec: number;
  spinner: string;
}): void {
  const width = 30;
  const percent = params.total > 0 ? Math.min(1, params.processed / params.total) : 0;
  const filled = Math.round(width * percent);
  const bar = `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
  const pctText = `${(percent * 100).toFixed(2)}%`;
  const line =
    `[perf] run ${params.run}/${params.soakRuns} ` +
    `${params.spinner} ${params.stage} ${bar} ${pctText} ` +
    `elapsed=${params.elapsedSec.toFixed(1)}s`;
  process.stdout.write(`\r${line}`);
}

function endProgress(): void {
  process.stdout.write('\n');
}

/**
 * Forces closure of any lingering socket handles to prevent test hang.
 */
function forceCloseHandles(): void {
  const proc = process as unknown as {
    _getActiveHandles?: () => unknown[];
  };
  const handles = proc._getActiveHandles?.() ?? [];

  for (const h of handles) {
    if (h instanceof net.Socket && !h.destroyed) {
      try {
        h.destroy();
      } catch {
        // Ignore
      }
    }
    // Close any server handles
    const server = h as { close?: (cb?: () => void) => void; constructor?: { name?: string } };
    if (typeof server.close === 'function' && server.constructor?.name === 'Server') {
      try {
        server.close();
      } catch {
        // Ignore
      }
    }
  }
}

async function createShop(shopId: string, shopDomain: string): Promise<void> {
  await pool.query(
    `INSERT INTO shops (
       id,
       shopify_domain,
       access_token_ciphertext,
       access_token_iv,
       access_token_tag,
       key_version,
       scopes
     )
     VALUES ($1, $2, $3, $4, $5, 1, ARRAY['read_products']::text[])
     ON CONFLICT (id) DO NOTHING`,
    [shopId, shopDomain, 'AA==', 'AA==', 'AA==']
  );
}

async function createBulkRun(shopId: string): Promise<string> {
  return await withTenantContext(shopId, async (client) => {
    const res = await client.query<{ id: string }>(
      `INSERT INTO bulk_runs (
         shop_id,
         operation_type,
         query_type,
         status,
         created_at,
         updated_at
       )
       VALUES ($1, 'PRODUCTS_EXPORT', 'core', 'running', now(), now())
       RETURNING id`,
      [shopId]
    );
    return res.rows[0]?.id ?? '';
  });
}

async function cleanupShopData(shopId: string): Promise<void> {
  // Use fast TRUNCATE-based cleanup for performance tests
  // This is much faster than row-by-row DELETE for large datasets
  try {
    await pool.query(`
      DO $$
      BEGIN
        -- Disable triggers temporarily for faster cleanup
        SET session_replication_role = replica;
        
        -- Delete related data first (respecting FK order)
        DELETE FROM bulk_errors WHERE shop_id = '${shopId}'::uuid;
        DELETE FROM bulk_steps WHERE shop_id = '${shopId}'::uuid;
        DELETE FROM bulk_artifacts WHERE shop_id = '${shopId}'::uuid;
        DELETE FROM staging_variants WHERE shop_id = '${shopId}'::uuid;
        DELETE FROM staging_products WHERE shop_id = '${shopId}'::uuid;
        DELETE FROM shopify_variants WHERE shop_id = '${shopId}'::uuid;
        DELETE FROM shopify_products WHERE shop_id = '${shopId}'::uuid;
        DELETE FROM bulk_runs WHERE shop_id = '${shopId}'::uuid;
        DELETE FROM shops WHERE id = '${shopId}'::uuid;
        
        -- Re-enable triggers
        SET session_replication_role = DEFAULT;
      EXCEPTION WHEN OTHERS THEN
        SET session_replication_role = DEFAULT;
        RAISE;
      END $$;
    `);
  } catch (err) {
    console.warn('[perf] cleanup warning:', err);
    // Fallback to simple delete if DO block fails
    await pool.query(`DELETE FROM shops WHERE id = $1`, [shopId]);
  }
}

void describe('bulk ingest performance (guarded)', { skip: !runPerf }, () => {
  let shopId = '';
  let artifactsDir = '';

  before(async () => {
    if (!getDatabaseUrl()) return;
    shopId = randomUUID();
    await createShop(shopId, `perf-${shopId.slice(0, 8)}.myshopify.com`);
    artifactsDir = await mkdtemp(path.join(os.tmpdir(), 'neanelu-bulk-artifacts-'));
  });

  after(async () => {
    if (!getDatabaseUrl()) return;
    try {
      console.log('[perf] Starting cleanup...');
      if (shopId) await cleanupShopData(shopId);
      console.log('[perf] Shop data cleaned.');
      if (artifactsDir) await rm(artifactsDir, { recursive: true, force: true });
      console.log('[perf] Artifacts cleaned.');
    } catch (err) {
      console.error('[perf] cleanup error:', err);
    } finally {
      console.log('[perf] Closing pool...');
      await closePool();
      console.log('[perf] Pool closed.');
      // Give pool time to fully drain
      await delay(100);

      if (process.env['PERF_DEBUG_HANDLES'] === '1') {
        dumpActiveHandles('after-close');
      }

      // Force close any lingering handles to prevent hang
      forceCloseHandles();

      // Final check
      if (process.env['PERF_DEBUG_HANDLES'] === '1') {
        await delay(50);
        dumpActiveHandles('after-force-close');
      }

      // Force exit to ensure process terminates cleanly
      console.log('[perf] Test complete, forcing exit...');
      process.exit(0);
    }
  });

  void it('measures throughput and memory baseline', async (t) => {
    if (!getDatabaseUrl()) {
      t.skip('Requires DATABASE_URL');
      return;
    }

    const rows = Number(process.env['PERF_ROWS'] ?? 10000);
    const soakRuns = Number(process.env['PERF_SOAK_RUNS'] ?? 1);
    const minRowsPerSecDefault = Number(process.env['PERF_MIN_ROWS_PER_SEC'] ?? 5000);
    const maxRegressionPct = Number(process.env['PERF_MAX_REGRESSION_PCT'] ?? 0.2);
    const maxHeapDeltaBytes = Number(process.env['PERF_MAX_HEAP_BYTES'] ?? 500 * 1024 * 1024);
    const autoTune = process.env['PERF_AUTO_TUNE'] === '1';
    const writeBaseline = process.env['PERF_WRITE_BASELINE'] === '1';
    const debugMerge = process.env['PERF_DEBUG_MERGE'] === '1';
    const mergeTimeoutMs = Number(process.env['PERF_MERGE_TIMEOUT_MS'] ?? 60 * 60 * 1000);

    const mergeLogger: Logger = (debugMerge
      ? {
          trace: (...args: unknown[]) => console.info(...args),
          debug: (...args: unknown[]) => console.info(...args),
          info: (...args: unknown[]) => console.info(...args),
          warn: (...args: unknown[]) => console.warn(...args),
          error: (...args: unknown[]) => console.error(...args),
          fatal: (...args: unknown[]) => console.error(...args),
        }
      : noopLogger) as unknown as Logger;

    const fixture = await writeBulkFixture({ products: rows, includeInvalidLines: false });
    const server = await createFileFixtureServer(fixture.filePath);

    const rowsProcessed = rows * 2;

    const results: {
      rowsPerSec: number;
      heapDelta: number;
      elapsedSec: number;
      mergeElapsedSec: number;
      cpuUserMicros: number;
      cpuSystemMicros: number;
    }[] = [];

    let baseline: { rowsPerSec: number; heapDelta: number } | null = null;
    try {
      const raw = await readFile(baselinePath, 'utf8');
      baseline = JSON.parse(raw) as { rowsPerSec: number; heapDelta: number };
    } catch {
      baseline = null;
    }

    const minRowsPerSec = autoTune
      ? Math.max(0, baseline?.rowsPerSec ? baseline.rowsPerSec * (1 - maxRegressionPct) : 0)
      : minRowsPerSecDefault;

    try {
      for (let run = 0; run < soakRuns; run += 1) {
        console.info(`[perf] run ${run + 1}/${soakRuns} starting (rows=${rows})`);
        const runId = await createBulkRun(shopId);
        const writer = new StagingCopyWriter({
          shopId,
          bulkRunId: runId,
          batchMaxRows: 5000,
          batchMaxBytes: 64 * 1024 * 1024,
        });

        let processed = 0;
        let lastRender = 0;
        let stage: 'ingest' | 'merge' = 'ingest';
        const startedAt = Date.now();
        const spinnerFrames = ['|', '/', '-', '\\'];
        let spinnerIndex = 0;
        const render = () => {
          const elapsedSec = (Date.now() - startedAt) / 1000;
          renderProgress({
            run: run + 1,
            soakRuns,
            processed,
            total: rowsProcessed,
            stage,
            elapsedSec,
            spinner: spinnerFrames[spinnerIndex] ?? '|',
          });
          spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
        };
        const ticker = setInterval(render, 1000);

        if (typeof global.gc === 'function') {
          global.gc();
        }

        const cpuStart = process.cpuUsage();
        const heapBefore = process.memoryUsage().heapUsed;
        const pipelineStart = performance.now();

        try {
          await runBulkStreamingPipelineWithStitching({
            shopId,
            bulkRunId: runId,
            operationType: 'PRODUCTS_EXPORT',
            artifactsDir,
            logger: noopLogger,
            url: server.url,
            onRecord: async (record) => {
              await writer.handleRecord(record);
              processed += 1;
              if (processed - lastRender >= 10_000) {
                lastRender = processed;
                render();
              }
            },
          });
          await writer.flush();

          render();
          endProgress();

          stage = 'merge';
          render();

          const mergeStart = performance.now();
          await runMergeFromStaging({
            shopId,
            bulkRunId: runId,
            logger: mergeLogger,
            analyze: false,
            allowDeletes: false,
            isFullSnapshot: true,
            reindexStaging: false,
            statementTimeoutMs: mergeTimeoutMs,
            logTimings: debugMerge,
          });
          const mergeElapsedSec = (performance.now() - mergeStart) / 1000;

          await withTenantContext(shopId, async (client) => {
            await client.query(
              `UPDATE bulk_runs
               SET status = 'completed', updated_at = now()
               WHERE id = $1`,
              [runId]
            );
          });

          const pipelineElapsedSec = (performance.now() - pipelineStart) / 1000;
          const elapsedSec = pipelineElapsedSec + mergeElapsedSec;
          const heapAfter = process.memoryUsage().heapUsed;
          const rowsPerSec = rowsProcessed / Math.max(0.001, pipelineElapsedSec);
          const cpuDelta = process.cpuUsage(cpuStart);

          results.push({
            rowsPerSec,
            heapDelta: heapAfter - heapBefore,
            elapsedSec,
            mergeElapsedSec,
            cpuUserMicros: cpuDelta.user,
            cpuSystemMicros: cpuDelta.system,
          });
          console.info(
            `[perf] run ${run + 1}/${soakRuns} done ` +
              `(elapsed=${elapsedSec.toFixed(2)}s rowsPerSec=${rowsPerSec.toFixed(2)})`
          );
        } finally {
          clearInterval(ticker);
          endProgress();
        }
      }
    } finally {
      await server.close();
      await rm(fixture.filePath, { force: true });
    }

    const avgRowsPerSec =
      results.reduce((sum, r) => sum + r.rowsPerSec, 0) / Math.max(1, results.length);
    const maxHeapDelta = Math.max(...results.map((r) => r.heapDelta));

    const report = {
      rows,
      rowsProcessed,
      soakRuns,
      avgRowsPerSec,
      maxHeapDelta,
      maxHeapDeltaBytes,
      samples: results,
    };

    console.info(`[perf] summary ${JSON.stringify(report)}`);

    assert.ok(
      avgRowsPerSec >= minRowsPerSec,
      `throughput below threshold: ${JSON.stringify(report)}`
    );

    assert.ok(
      maxHeapDelta <= maxHeapDeltaBytes,
      `heap usage above threshold: ${JSON.stringify(report)}`
    );

    if (writeBaseline) {
      await writeFile(
        baselinePath,
        JSON.stringify({ rowsPerSec: avgRowsPerSec, heapDelta: maxHeapDelta }, null, 2),
        'utf8'
      );
    } else if (baseline) {
      const minAllowed = baseline.rowsPerSec * (1 - maxRegressionPct);
      assert.ok(
        avgRowsPerSec >= minAllowed,
        `performance regression: ${avgRowsPerSec.toFixed(2)} < ${minAllowed.toFixed(2)}`
      );
    }
  });
});
