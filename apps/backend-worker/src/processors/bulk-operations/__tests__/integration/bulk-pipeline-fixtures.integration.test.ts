import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

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

function isIntegrationEnvPresent(): boolean {
  return Boolean(
    (process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL']) && process.env['REDIS_URL']
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
  'bulk pipeline integration (generated fixtures)',
  { skip: !isIntegrationEnvPresent() },
  () => {
    after(async () => {
      if (!isIntegrationEnvPresent()) return;
      if (process.env['SMOKE_RUN'] === '1') {
        await closePool();
      }
    });

    void it('ingests small (100 rows) fixture', async (t) => {
      if (!isIntegrationEnvPresent()) {
        t.skip('Requires DATABASE_URL and REDIS_URL');
        return;
      }

      const shopId = randomUUID();
      await createShop(shopId, 'fixture-small.myshopify.com');

      const fixture = await writeBulkFixture({
        products: 50,
        includeInvalidLines: true,
        includeSpecialChars: true,
      });
      const server = await createFileFixtureServer(fixture.filePath);

      try {
        const bulkRunId = await createBulkRun(shopId);
        const writer = new StagingCopyWriter({
          shopId,
          bulkRunId,
          batchMaxRows: 200,
          batchMaxBytes: 2 * 1024 * 1024,
        });

        await runBulkStreamingPipelineWithStitching({
          shopId,
          bulkRunId,
          operationType: 'PRODUCTS_EXPORT',
          artifactsDir: fixture.filePath.replace(/\.jsonl$/, ''),
          logger: noopLogger,
          url: server.url,
          onRecord: async (record) => {
            await writer.handleRecord(record);
          },
        });

        await writer.flush();
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

        assert.equal(productCount, 50);
      } finally {
        await server.close();
        await rm(fixture.filePath, { force: true });
        await cleanupShopData(shopId);
      }
    });

    void it('ingests medium (10k rows) fixture', async (t) => {
      if (!isIntegrationEnvPresent() || process.env['RUN_MEDIUM_FIXTURE'] !== '1') {
        t.skip('Requires RUN_MEDIUM_FIXTURE=1 and integration env');
        return;
      }

      const shopId = randomUUID();
      await createShop(shopId, 'fixture-medium.myshopify.com');

      const fixture = await writeBulkFixture({ products: 5000, includeInvalidLines: false });
      const server = await createFileFixtureServer(fixture.filePath);

      try {
        const bulkRunId = await createBulkRun(shopId);
        const writer = new StagingCopyWriter({
          shopId,
          bulkRunId,
          batchMaxRows: 5000,
          batchMaxBytes: 8 * 1024 * 1024,
        });

        await runBulkStreamingPipelineWithStitching({
          shopId,
          bulkRunId,
          operationType: 'PRODUCTS_EXPORT',
          artifactsDir: fixture.filePath.replace(/\.jsonl$/, ''),
          logger: noopLogger,
          url: server.url,
          onRecord: async (record) => {
            await writer.handleRecord(record);
          },
        });

        await writer.flush();
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

        assert.equal(productCount, 5000);
      } finally {
        await server.close();
        await rm(fixture.filePath, { force: true });
        await cleanupShopData(shopId);
      }
    });

    void it('ingests large (100k rows) fixture', async (t) => {
      if (!isIntegrationEnvPresent() || process.env['RUN_LARGE_FIXTURE'] !== '1') {
        t.skip('Requires RUN_LARGE_FIXTURE=1 and integration env');
        return;
      }

      const shopId = randomUUID();
      await createShop(shopId, 'fixture-large.myshopify.com');

      const fixture = await writeBulkFixture({ products: 50000, includeInvalidLines: false });
      const server = await createFileFixtureServer(fixture.filePath);

      try {
        const bulkRunId = await createBulkRun(shopId);
        const writer = new StagingCopyWriter({
          shopId,
          bulkRunId,
          batchMaxRows: 10000,
          batchMaxBytes: 16 * 1024 * 1024,
        });

        await runBulkStreamingPipelineWithStitching({
          shopId,
          bulkRunId,
          operationType: 'PRODUCTS_EXPORT',
          artifactsDir: fixture.filePath.replace(/\.jsonl$/, ''),
          logger: noopLogger,
          url: server.url,
          onRecord: async (record) => {
            await writer.handleRecord(record);
          },
        });

        await writer.flush();
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

        assert.equal(productCount, 50000);
      } finally {
        await server.close();
        await rm(fixture.filePath, { force: true });
        await cleanupShopData(shopId);
      }
    });
  }
);
