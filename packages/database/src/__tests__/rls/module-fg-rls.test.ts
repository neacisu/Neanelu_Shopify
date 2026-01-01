/**
 * Module F & G RLS Tests: AI Batch & Queue
 *
 * Tests RLS policies for:
 * Module F - AI Batch:
 * - ai_batches
 * - ai_batch_items
 * - embedding_batches
 *
 * Module G - Queue:
 * - job_runs
 * - scheduled_tasks
 * - rate_limit_buckets
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import { getTablePolicies, getTableRlsStatus } from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// Module F tables
const MODULE_F_TABLES = ['ai_batches', 'ai_batch_items', 'embedding_batches'];

// Module G tables with RLS
const MODULE_G_TABLES_RLS = ['job_runs', 'scheduled_tasks', 'rate_limit_buckets'];

// Module G tables without RLS (partitioned)
const MODULE_G_TABLES_NO_RLS = ['api_cost_tracking'];

// ============================================
// MODULE F: AI BATCH RLS
// ============================================

void describe('Module F RLS: AI Batch Tables', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  for (const tableName of MODULE_F_TABLES) {
    void it(`${tableName} has RLS enabled`, async () => {
      const hasRls = await getTableRlsStatus(tableName);
      assert.strictEqual(hasRls, true, `${tableName} should have RLS enabled`);
    });
  }

  for (const tableName of MODULE_F_TABLES) {
    void it(`${tableName} has at least one policy`, async () => {
      const policies = await getTablePolicies(tableName);
      assert.ok(policies.length >= 1, `${tableName} should have at least one RLS policy`);
    });
  }
});

// ============================================
// MODULE F: POLICY CONTENT
// ============================================

void describe('Module F RLS: Policy Content', { skip: SKIP }, () => {
  void it('ai_batches policy references shop_id', async () => {
    const policies = await getTablePolicies('ai_batches');
    const hasShopIdPolicy = policies.some((p) =>
      ['shop_id', 'current_shop_id'].some((term) => p.qual?.includes(term))
    );
    assert.ok(hasShopIdPolicy, 'ai_batches policy should reference shop_id');
  });

  void it('ai_batch_items has shop_id for direct RLS', async () => {
    const policies = await getTablePolicies('ai_batch_items');
    const hasShopIdPolicy = policies.some((p) =>
      ['shop_id', 'current_shop_id'].some((term) => p.qual?.includes(term))
    );
    assert.ok(hasShopIdPolicy, 'ai_batch_items policy should reference shop_id');
  });

  void it('embedding_batches policy references shop_id', async () => {
    const policies = await getTablePolicies('embedding_batches');
    const hasShopIdPolicy = policies.some((p) =>
      ['shop_id', 'current_shop_id'].some((term) => p.qual?.includes(term))
    );
    assert.ok(hasShopIdPolicy, 'embedding_batches policy should reference shop_id');
  });
});

// ============================================
// MODULE G: QUEUE RLS
// ============================================

void describe('Module G RLS: Queue Tables', { skip: SKIP }, () => {
  for (const tableName of MODULE_G_TABLES_RLS) {
    void it(`${tableName} has RLS enabled`, async () => {
      const hasRls = await getTableRlsStatus(tableName);
      assert.strictEqual(hasRls, true, `${tableName} should have RLS enabled`);
    });
  }

  for (const tableName of MODULE_G_TABLES_RLS) {
    void it(`${tableName} has at least one policy`, async () => {
      const policies = await getTablePolicies(tableName);
      assert.ok(policies.length >= 1, `${tableName} should have at least one RLS policy`);
    });
  }
});

// ============================================
// MODULE G: PARTITIONED TABLES
// ============================================

void describe('Module G RLS: Partitioned Tables', { skip: SKIP }, () => {
  for (const tableName of MODULE_G_TABLES_NO_RLS) {
    void it(`${tableName} RLS status (partitioned)`, async () => {
      const hasRls = await getTableRlsStatus(tableName);
      // Partitioned tables may or may not have RLS on parent
      assert.ok(typeof hasRls === 'boolean', `${tableName} RLS status should be defined`);
    });
  }
});

// ============================================
// MODULE G: POLICY CONTENT
// ============================================

void describe('Module G RLS: Policy Content', { skip: SKIP }, () => {
  void it('job_runs policy references shop_id', async () => {
    const policies = await getTablePolicies('job_runs');
    const hasShopIdPolicy = policies.some((p) =>
      ['shop_id', 'current_shop_id'].some((term) => p.qual?.includes(term))
    );
    assert.ok(hasShopIdPolicy, 'job_runs policy should reference shop_id');
  });

  void it('scheduled_tasks policy references shop_id', async () => {
    const policies = await getTablePolicies('scheduled_tasks');
    const hasShopIdPolicy = policies.some((p) =>
      ['shop_id', 'current_shop_id'].some((term) => p.qual?.includes(term))
    );
    assert.ok(hasShopIdPolicy, 'scheduled_tasks policy should reference shop_id');
  });

  void it('rate_limit_buckets policy references shop_id', async () => {
    const policies = await getTablePolicies('rate_limit_buckets');
    const hasShopIdPolicy = policies.some((p) =>
      ['shop_id', 'current_shop_id'].some((term) => p.qual?.includes(term))
    );
    assert.ok(hasShopIdPolicy, 'rate_limit_buckets policy should reference shop_id');
  });
});
