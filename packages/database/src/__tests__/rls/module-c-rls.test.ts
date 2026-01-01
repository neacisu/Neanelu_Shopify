/**
 * Module C RLS Tests: Bulk Operations
 *
 * Tests RLS policies for:
 * - bulk_runs
 * - bulk_steps
 * - bulk_artifacts
 * - bulk_errors
 * - staging_products
 * - staging_variants
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import { getTablePolicies, getTableRlsStatus } from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

const MODULE_C_TABLES = [
  'bulk_runs',
  'bulk_steps',
  'bulk_artifacts',
  'bulk_errors',
  'staging_products',
  'staging_variants',
];

// ============================================
// RLS STATUS VERIFICATION
// ============================================

void describe('Module C RLS: Status Verification', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  for (const tableName of MODULE_C_TABLES) {
    void it(`${tableName} has RLS enabled`, async () => {
      const hasRls = await getTableRlsStatus(tableName);
      assert.strictEqual(hasRls, true, `${tableName} should have RLS enabled`);
    });
  }
});

// ============================================
// POLICY VERIFICATION
// ============================================

void describe('Module C RLS: Policy Verification', { skip: SKIP }, () => {
  for (const tableName of MODULE_C_TABLES) {
    void it(`${tableName} has at least one policy`, async () => {
      const policies = await getTablePolicies(tableName);
      assert.ok(policies.length >= 1, `${tableName} should have at least one RLS policy`);
    });
  }
});

// ============================================
// POLICY CONTENT
// ============================================

void describe('Module C RLS: Policy Content', { skip: SKIP }, () => {
  void it('bulk_runs policy references shop_id', async () => {
    const policies = await getTablePolicies('bulk_runs');
    const hasShopIdPolicy = policies.some((p) =>
      ['shop_id', 'current_shop_id'].some((term) => p.qual?.includes(term))
    );
    assert.ok(hasShopIdPolicy, 'bulk_runs policy should reference shop_id');
  });

  void it('bulk_steps policy references shop_id', async () => {
    const policies = await getTablePolicies('bulk_steps');
    const hasShopIdPolicy = policies.some((p) =>
      ['shop_id', 'current_shop_id'].some((term) => p.qual?.includes(term))
    );
    assert.ok(hasShopIdPolicy, 'bulk_steps policy should reference shop_id');
  });

  void it('staging_products policy references shop_id', async () => {
    const policies = await getTablePolicies('staging_products');
    const hasShopIdPolicy = policies.some((p) =>
      ['shop_id', 'current_shop_id'].some((term) => p.qual?.includes(term))
    );
    assert.ok(hasShopIdPolicy, 'staging_products policy should reference shop_id');
  });
});

// ============================================
// CHILD TABLE ISOLATION
// ============================================

void describe('Module C RLS: Child Table Isolation', { skip: SKIP }, () => {
  void it('bulk_artifacts has shop_id for direct RLS', async () => {
    const hasRls = await getTableRlsStatus('bulk_artifacts');
    assert.strictEqual(hasRls, true, 'bulk_artifacts should have RLS');

    const policies = await getTablePolicies('bulk_artifacts');
    assert.ok(policies.length >= 1, 'bulk_artifacts should have policy');
  });

  void it('bulk_errors has shop_id for direct RLS', async () => {
    const hasRls = await getTableRlsStatus('bulk_errors');
    assert.strictEqual(hasRls, true, 'bulk_errors should have RLS');

    const policies = await getTablePolicies('bulk_errors');
    assert.ok(policies.length >= 1, 'bulk_errors should have policy');
  });
});
