import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Logger } from '@app/logger';
import { pool, closePool, setTenantContext, withTenantContext } from '@app/database';

import { StagingCopyWriter } from '../../pipeline/stages/copy-writer.js';
import { runMergeFromStaging } from '../../pipeline/stages/merge.js';
import { runBulkStreamingPipelineWithStitching } from '../../pipeline/index.js';
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

void describe(
  'bulk pipeline integration (fixture → staging → merge)',
  { skip: !isIntegrationEnvPresent() },
  () => {
    let shopId = '';
    let artifactsDir = '';

    before(async () => {
      shopId = randomUUID();
      await createShop(shopId, 'integration.myshopify.com');
      artifactsDir = await mkdtemp(path.join(os.tmpdir(), 'neanelu-bulk-artifacts-'));
    });

    after(async () => {
      if (!isIntegrationEnvPresent()) return;

      try {
        await cleanupShopData(shopId);
        if (artifactsDir) {
          await rm(artifactsDir, { recursive: true, force: true });
        }
      } finally {
        if (process.env['SMOKE_RUN'] === '1') {
          await closePool();
        }
      }
    });

    void it('ingests a JSONL fixture and enforces RLS', async (t) => {
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

      try {
        const bulkRunId = await createBulkRun(shopId);
        const copyWriter = new StagingCopyWriter({
          shopId,
          bulkRunId,
          batchMaxRows: 2,
          batchMaxBytes: 1024 * 1024,
        });

        const result = await runBulkStreamingPipelineWithStitching({
          shopId,
          bulkRunId,
          operationType: 'PRODUCTS_EXPORT',
          artifactsDir,
          logger: noopLogger,
          url: server.url,
          onRecord: async (record) => {
            await copyWriter.handleRecord(record);
          },
        });

        await copyWriter.flush();

        assert.ok(result.counters.validLines >= 4);
        assert.ok(result.counters.invalidLines >= 1);

        await runMergeFromStaging({
          shopId,
          bulkRunId,
          logger: noopLogger,
          analyze: false,
          allowDeletes: false,
          isFullSnapshot: true,
          reindexStaging: false,
        });

        await withTenantContext(shopId, async (client) => {
          await client.query(
            `UPDATE bulk_runs
           SET status = 'completed', updated_at = now()
           WHERE id = $1`,
            [bulkRunId]
          );
        });

        const productCount = await withTenantContext(shopId, async (client) => {
          const res = await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM shopify_products WHERE shop_id = $1`,
            [shopId]
          );
          return Number(res.rows[0]?.count ?? 0);
        });

        const variantCount = await withTenantContext(shopId, async (client) => {
          const res = await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM shopify_variants WHERE shop_id = $1`,
            [shopId]
          );
          return Number(res.rows[0]?.count ?? 0);
        });

        assert.equal(productCount, 2);
        assert.equal(variantCount, 2);

        // RLS enforcement: without tenant context, rows should be hidden; with context, visible.
        const client = await pool.connect();
        try {
          await client.query(`DO $$
            BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'test_rls') THEN
                CREATE ROLE test_rls;
              END IF;
            END $$;`);
          await client.query('GRANT SELECT ON shopify_products, shopify_variants TO test_rls');

          await client.query('BEGIN');
          await client.query('SET LOCAL ROLE test_rls');

          const withoutCtx = await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM shopify_products`
          );
          assert.equal(Number(withoutCtx.rows[0]?.count ?? 0), 0);

          await setTenantContext(client, shopId);
          const withCtx = await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM shopify_products`
          );
          assert.equal(Number(withCtx.rows[0]?.count ?? 0), 2);

          await client.query('COMMIT');
        } finally {
          client.release();
        }
      } finally {
        await server.close();
      }
    });

    void it('is idempotent across repeated runs', async (t) => {
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

      try {
        for (let run = 0; run < 2; run += 1) {
          const runId = await createBulkRun(shopId);
          const writer = new StagingCopyWriter({
            shopId,
            bulkRunId: runId,
            batchMaxRows: 3,
            batchMaxBytes: 1024 * 1024,
          });

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

          await withTenantContext(shopId, async (client) => {
            await client.query(
              `UPDATE bulk_runs
             SET status = 'completed', updated_at = now()
             WHERE id = $1`,
              [runId]
            );
          });
        }

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
  }
);
