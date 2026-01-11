import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { abortBulkRunIfErrorRateExceeded } from '../state-machine.js';

const MOCK_SHOP_DOMAIN = 'test-error-rate.myshopify.com';

function isCiIntegrationEnvPresent(): boolean {
  if ((process.env['SMOKE_RUN'] ?? '').trim() !== '1') return false;

  const required = [
    'APP_HOST',
    'DATABASE_URL',
    'REDIS_URL',
    'BULLMQ_PRO_TOKEN',
    'SHOPIFY_API_KEY',
    'SHOPIFY_API_SECRET',
    'SCOPES',
    'ENCRYPTION_KEY_VERSION',
    'ENCRYPTION_KEY_256',
    'OTEL_SERVICE_NAME',
  ];

  return required.every((k) => Boolean(process.env[k]?.trim()));
}

void describe('smoke: error rate threshold abort (F5.1.7)', () => {
  let shopId: string;
  let bulkRunId: string;

  before(async () => {
    shopId = randomUUID();
    bulkRunId = '';

    if (!isCiIntegrationEnvPresent()) return;

    const { pool } = await import('@app/database');

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
      [shopId, MOCK_SHOP_DOMAIN, 'AA==', 'AA==', 'AA==']
    );

    const { withTenantContext } = await import('@app/database');
    bulkRunId = await withTenantContext(shopId, async (client) => {
      const res = await client.query<{ id: string }>(
        `INSERT INTO bulk_runs (
           shop_id,
           operation_type,
           query_type,
           status,
           records_processed,
           created_at,
           updated_at
         )
         VALUES ($1, 'PRODUCTS_EXPORT', 'core', 'running', 100, now(), now())
         RETURNING id`,
        [shopId]
      );
      return res.rows[0]?.id ?? '';
    });

    assert.ok(bulkRunId);

    // Insert 11 row-level errors (>= 10% of 100) => should abort.
    await withTenantContext(shopId, async (client) => {
      for (let i = 0; i < 11; i++) {
        await client.query(
          `INSERT INTO bulk_errors (
             bulk_run_id,
             shop_id,
             error_type,
             error_code,
             error_message,
             line_number,
             payload,
             created_at
           )
           VALUES ($1, $2, 'pipeline_row_error', 'ERR', 'row failed', $3, NULL, now())`,
          [bulkRunId, shopId, i + 1]
        );
      }
    });
  });

  after(async () => {
    if (!isCiIntegrationEnvPresent()) return;

    const { pool, withTenantContext, closePool } = await import('@app/database');

    await withTenantContext(shopId, async (client) => {
      await client.query(`DELETE FROM bulk_runs WHERE shop_id = $1`, [shopId]);
    });

    await pool.query(`DELETE FROM shops WHERE id = $1`, [shopId]);

    if (process.env['SMOKE_RUN'] === '1') {
      await closePool();
    }
  });

  void it('aborts the run when error rate exceeds threshold', async (t) => {
    if (!isCiIntegrationEnvPresent()) {
      t.skip('Requires DATABASE_URL/REDIS_URL/BULLMQ_PRO_TOKEN and other CI env vars');
      return;
    }

    const aborted = await abortBulkRunIfErrorRateExceeded({ shopId, bulkRunId, threshold: 0.1 });
    assert.equal(aborted, true);

    const { withTenantContext } = await import('@app/database');
    const row = await withTenantContext(shopId, async (client) => {
      const res = await client.query<{ status: string; error_message: string | null }>(
        `SELECT status, error_message
         FROM bulk_runs
         WHERE id = $1`,
        [bulkRunId]
      );
      return res.rows[0] ?? null;
    });

    assert.equal(row?.status, 'failed');
    assert.ok((row?.error_message ?? '').includes('error_rate_threshold_exceeded'));
  });
});
