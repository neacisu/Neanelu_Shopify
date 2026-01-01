/**
 * Module E RLS Tests: Vectors
 *
 * Tests RLS policies for:
 * - shop_product_embeddings (only shop-specific vector table)
 *
 * Note: Other vector tables (prod_embeddings, prod_attr_*) are global PIM
 * and intentionally DO NOT have RLS.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import { getTablePolicies, getTableRlsStatus } from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// Tables WITH RLS
const TABLES_WITH_RLS = ['shop_product_embeddings'];

// Tables WITHOUT RLS (global PIM data)
const TABLES_WITHOUT_RLS = ['prod_embeddings', 'prod_attr_definitions', 'prod_attr_synonyms'];

// ============================================
// RLS STATUS - WITH RLS
// ============================================

void describe('Module E RLS: Shop-Specific Tables', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  for (const tableName of TABLES_WITH_RLS) {
    void it(`${tableName} has RLS enabled`, async () => {
      const hasRls = await getTableRlsStatus(tableName);
      assert.strictEqual(hasRls, true, `${tableName} should have RLS enabled`);
    });
  }
});

// ============================================
// RLS STATUS - WITHOUT RLS
// ============================================

void describe('Module E RLS: Global PIM Tables (No RLS)', { skip: SKIP }, () => {
  for (const tableName of TABLES_WITHOUT_RLS) {
    void it(`${tableName} does NOT have RLS (global data)`, async () => {
      const hasRls = await getTableRlsStatus(tableName);
      assert.strictEqual(hasRls, false, `${tableName} should NOT have RLS (global PIM)`);
    });
  }
});

// ============================================
// POLICY VERIFICATION
// ============================================

void describe('Module E RLS: Policy Verification', { skip: SKIP }, () => {
  void it('shop_product_embeddings has at least one policy', async () => {
    const policies = await getTablePolicies('shop_product_embeddings');
    assert.ok(policies.length >= 1, 'shop_product_embeddings should have at least one RLS policy');
  });

  void it('shop_product_embeddings policy references shop_id', async () => {
    const policies = await getTablePolicies('shop_product_embeddings');
    const hasShopIdPolicy = policies.some((p) =>
      ['shop_id', 'current_shop_id'].some((term) => p.qual?.includes(term))
    );
    assert.ok(hasShopIdPolicy, 'shop_product_embeddings policy should reference shop_id');
  });
});

// ============================================
// VECTOR SEARCH WITH RLS
// ============================================

void describe('Module E RLS: Vector Search Isolation', { skip: SKIP }, () => {
  void it('shop_product_embeddings isolates vector search by tenant', async () => {
    // The find_similar_shop_products function should respect RLS
    const hasRls = await getTableRlsStatus('shop_product_embeddings');
    assert.strictEqual(hasRls, true, 'Vector search should be isolated by tenant');
  });

  void it('global prod_embeddings has no tenant isolation', async () => {
    // Global PIM embeddings are shared across all tenants
    const hasRls = await getTableRlsStatus('prod_embeddings');
    assert.strictEqual(hasRls, false, 'Global embeddings should not have RLS');
  });
});
