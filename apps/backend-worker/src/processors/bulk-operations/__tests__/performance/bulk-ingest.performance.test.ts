import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';

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
  await withTenantContext(shopId, async (client) => {
    await client.query(`DELETE FROM bulk_errors WHERE shop_id = $1`, [shopId]);
    await client.query(`DELETE FROM bulk_steps WHERE shop_id = $1`, [shopId]);
    await client.query(`DELETE FROM bulk_artifacts WHERE shop_id = $1`, [shopId]);
    await client.query(`DELETE FROM staging_variants WHERE shop_id = $1`, [shopId]);
    await client.query(`DELETE FROM staging_products WHERE shop_id = $1`, [shopId]);
    await client.query(`DELETE FROM shopify_variants WHERE shop_id = $1`, [shopId]);
    await client.query(`DELETE FROM shopify_products WHERE shop_id = $1`, [shopId]);
    await client.query(`DELETE FROM bulk_runs WHERE shop_id = $1`, [shopId]);
  });

  await pool.query(`DELETE FROM shops WHERE id = $1`, [shopId]);
}

void describe('bulk ingest performance (guarded)', { skip: !runPerf }, () => {
  let shopId = '';
  let artifactsDir = '';

  before(async () => {
    if (!getDatabaseUrl()) return;
    shopId = randomUUID();
    await createShop(shopId, 'perf.myshopify.com');
    artifactsDir = await mkdtemp(path.join(os.tmpdir(), 'neanelu-bulk-artifacts-'));
  });

  after(async () => {
    if (!getDatabaseUrl()) return;
    try {
      if (shopId) await cleanupShopData(shopId);
      if (artifactsDir) await rm(artifactsDir, { recursive: true, force: true });
    } finally {
      if (process.env['SMOKE_RUN'] === '1') {
        await closePool();
      }
    }
  });

  void it('measures throughput and memory baseline', async (t) => {
    if (!getDatabaseUrl()) {
      t.skip('Requires DATABASE_URL');
      return;
    }

    const rows = Number(process.env['PERF_ROWS'] ?? 10000);
    const soakRuns = Number(process.env['PERF_SOAK_RUNS'] ?? 1);
    const minRowsPerSec = Number(process.env['PERF_MIN_ROWS_PER_SEC'] ?? 500);
    const maxRegressionPct = Number(process.env['PERF_MAX_REGRESSION_PCT'] ?? 0.2);
    const writeBaseline = process.env['PERF_WRITE_BASELINE'] === '1';

    const fixture = await writeBulkFixture({ products: rows, includeInvalidLines: false });
    const server = await createFileFixtureServer(fixture.filePath);

    const rowsProcessed = rows * 2;

    const results: { rowsPerSec: number; heapDelta: number; elapsedSec: number }[] = [];

    try {
      for (let run = 0; run < soakRuns; run += 1) {
        const runId = await createBulkRun(shopId);
        const writer = new StagingCopyWriter({
          shopId,
          bulkRunId: runId,
          batchMaxRows: 1000,
          batchMaxBytes: 16 * 1024 * 1024,
        });

        const heapBefore = process.memoryUsage().heapUsed;
        const started = performance.now();

        await runBulkStreamingPipelineWithStitching({
          shopId,
          bulkRunId: runId,
          operationType: 'PRODUCTS_EXPORT',
          artifactsDir,
          logger: noopLogger,
          url: server.url,
          onRecord: async (record) => {
            await writer.handleRecord(record);
          },
        });
        await writer.flush();

        await runMergeFromStaging({
          shopId,
          bulkRunId: runId,
          logger: noopLogger,
          analyze: false,
          allowDeletes: false,
          isFullSnapshot: true,
          reindexStaging: false,
        });

        const elapsedSec = (performance.now() - started) / 1000;
        const heapAfter = process.memoryUsage().heapUsed;
        const rowsPerSec = rowsProcessed / Math.max(0.001, elapsedSec);

        results.push({
          rowsPerSec,
          heapDelta: heapAfter - heapBefore,
          elapsedSec,
        });
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
      samples: results,
    };

    assert.ok(
      avgRowsPerSec >= minRowsPerSec,
      `throughput below threshold: ${JSON.stringify(report)}`
    );

    let baseline: { rowsPerSec: number; heapDelta: number } | null = null;
    try {
      const raw = await readFile(baselinePath, 'utf8');
      baseline = JSON.parse(raw) as { rowsPerSec: number; heapDelta: number };
    } catch {
      baseline = null;
    }

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
