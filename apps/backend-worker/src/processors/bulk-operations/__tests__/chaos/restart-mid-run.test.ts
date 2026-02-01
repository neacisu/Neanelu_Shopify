import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Logger } from '@app/logger';
import { pool, closePool, withTenantContext } from '@app/database';

import { StagingCopyWriter } from '../../pipeline/stages/copy-writer.js';
import { runMergeFromStaging } from '../../pipeline/stages/merge.js';
import { runBulkStreamingPipelineWithStitching } from '../../pipeline/index.js';
import { persistIngestCheckpoint, readIngestCheckpoint } from '../../pipeline/checkpoint.js';
import { loadBulkRunContext } from '../../state-machine.js';
import { createRangeFixtureServer } from '../helpers/fixture-server.js';

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

function isIntegrationEnvPresent(): boolean {
  return Boolean(
    process.env['RUN_INTEGRATION_TESTS'] === '1' && getDatabaseUrl() && process.env['REDIS_URL']
  );
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

void describe('chaos: restart mid-run resume', { skip: !isIntegrationEnvPresent() }, () => {
  let shopId = '';
  let bulkRunId = '';
  let artifactsDir = '';

  before(async () => {
    shopId = randomUUID();
    await createShop(shopId, 'restart.myshopify.com');
    bulkRunId = await createBulkRun(shopId);
    artifactsDir = await mkdtemp(path.join(os.tmpdir(), 'neanelu-bulk-artifacts-'));
  });

  after(async () => {
    if (!isIntegrationEnvPresent()) return;
    try {
      await cleanupShopData(shopId);
      if (artifactsDir) await rm(artifactsDir, { recursive: true, force: true });
    } finally {
      if (process.env['SMOKE_RUN'] === '1') {
        await closePool();
      }
    }
  });

  void it('resumes from checkpoint without duplicates', async (t) => {
    if (!isIntegrationEnvPresent()) {
      t.skip('Requires RUN_INTEGRATION_TESTS=1, DATABASE_URL, and REDIS_URL');
      return;
    }

    const fixtureUrl = new URL(
      '../../../../__tests__/fixtures/bulk/basic-products.jsonl',
      import.meta.url
    );
    const payload = await readFile(fixtureUrl);
    const server = await createRangeFixtureServer(payload);

    const counters = {
      bytesProcessed: 0,
      totalLines: 0,
      validLines: 0,
      invalidLines: 0,
    };

    try {
      let seen = 0;
      const writer = new StagingCopyWriter({
        shopId,
        bulkRunId,
        batchMaxRows: 2,
        batchMaxBytes: 1024 * 1024,
      });

      await assert.rejects(async () => {
        await runBulkStreamingPipelineWithStitching({
          shopId,
          bulkRunId,
          operationType: 'PRODUCTS_EXPORT',
          artifactsDir,
          logger: noopLogger,
          url: server.url,
          counters,
          onRecord: async (record) => {
            await writer.handleRecord(record);
            seen += 1;
            if (seen === 2) {
              throw new Error('simulated_crash');
            }
          },
        });
      }, /simulated_crash/);

      await writer.flush();

      const writerCounters = writer.getCounters();

      await persistIngestCheckpoint({
        shopId,
        bulkRunId,
        recordsProcessed: writerCounters.recordsSeen,
        bytesProcessed: counters.bytesProcessed,
        checkpoint: {
          version: 2,
          committedRecords: writerCounters.recordsSeen,
          committedProducts: writerCounters.productsCopied,
          committedVariants: writerCounters.variantsCopied,
          committedBytes: counters.bytesProcessed,
          committedLines: counters.totalLines,
          lastSuccessfulId: null,
          lastCommitAtIso: new Date().toISOString(),
          isFullSnapshot: true,
        },
      });

      const ctx = await loadBulkRunContext({ shopId, bulkRunId });
      const checkpoint = readIngestCheckpoint(ctx?.cursor_state);
      assert.ok(checkpoint?.version === 2);

      const resumeFromBytes = computeResumeOffset(payload, writerCounters.recordsSeen);

      const writer2 = new StagingCopyWriter({
        shopId,
        bulkRunId,
        batchMaxRows: 3,
        batchMaxBytes: 1024 * 1024,
      });

      await runBulkStreamingPipelineWithStitching({
        shopId,
        bulkRunId,
        operationType: 'PRODUCTS_EXPORT',
        artifactsDir,
        logger: noopLogger,
        url: server.url,
        resumeFromBytes,
        onRecord: async (record) => {
          await writer2.handleRecord(record);
        },
      });

      await writer2.flush();

      await runMergeFromStaging({
        shopId,
        bulkRunId,
        logger: noopLogger,
        analyze: false,
        allowDeletes: false,
        isFullSnapshot: true,
        reindexStaging: false,
      });

      const productCount = await withTenantContext(shopId, async (client) => {
        const res = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM shopify_products WHERE shop_id = $1`,
          [shopId]
        );
        return Number(res.rows[0]?.count ?? 0);
      });

      assert.equal(productCount, 2);
    } finally {
      await server.close();
    }
  });
});

function computeResumeOffset(payload: Buffer, recordsSeen: number): number {
  if (recordsSeen <= 0) return 0;
  let linesSeen = 0;
  let offset = 0;
  for (let i = 0; i < payload.length; i += 1) {
    if (payload[i] === 0x0a) {
      linesSeen += 1;
      offset = i + 1;
      if (linesSeen >= recordsSeen) break;
    }
  }
  return Math.max(0, offset);
}
