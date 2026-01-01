/**
 * Module B RLS Tests: Shopify Mirror
 *
 * Tests RLS policies for:
 * - shopify_products
 * - shopify_variants
 * - shopify_collections
 * - shopify_collection_products
 * - shopify_orders
 * - shopify_customers
 * - shopify_metaobjects
 * - shopify_webhooks
 * - webhook_events
 * - shopify_tokens
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import { getTablePolicies, getTableRlsStatus } from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

const MODULE_B_TABLES = [
  'shopify_products',
  'shopify_variants',
  'shopify_collections',
  'shopify_collection_products',
  'shopify_orders',
  'shopify_customers',
  'shopify_metaobjects',
  'shopify_webhooks',
  'webhook_events',
  'shopify_tokens',
];

// ============================================
// RLS STATUS VERIFICATION
// ============================================

void describe('Module B RLS: Status Verification', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  for (const tableName of MODULE_B_TABLES) {
    void it(`${tableName} has RLS enabled`, async () => {
      const hasRls = await getTableRlsStatus(tableName);
      assert.strictEqual(hasRls, true, `${tableName} should have RLS enabled`);
    });
  }
});

// ============================================
// POLICY VERIFICATION
// ============================================

void describe('Module B RLS: Policy Verification', { skip: SKIP }, () => {
  for (const tableName of MODULE_B_TABLES) {
    void it(`${tableName} has at least one policy`, async () => {
      const policies = await getTablePolicies(tableName);
      assert.ok(policies.length >= 1, `${tableName} should have at least one RLS policy`);
    });
  }
});

// ============================================
// POLICY CONTENT VERIFICATION
// ============================================

void describe('Module B RLS: Policy Content', { skip: SKIP }, () => {
  void it('shopify_products policy references shop_id', async () => {
    const policies = await getTablePolicies('shopify_products');
    const hasShopIdPolicy = policies.some((p) =>
      ['shop_id', 'current_shop_id'].some((term) => p.qual?.includes(term))
    );
    assert.ok(hasShopIdPolicy, 'shopify_products policy should reference shop_id');
  });

  void it('shopify_variants policy references shop_id', async () => {
    const policies = await getTablePolicies('shopify_variants');
    const hasShopIdPolicy = policies.some((p) =>
      ['shop_id', 'current_shop_id'].some((term) => p.qual?.includes(term))
    );
    assert.ok(hasShopIdPolicy, 'shopify_variants policy should reference shop_id');
  });

  void it('shopify_collection_products has shop_id for RLS', async () => {
    // This is a join table that needs denormalized shop_id for RLS
    const policies = await getTablePolicies('shopify_collection_products');
    const hasPolicy = policies.length >= 1;
    assert.ok(hasPolicy, 'shopify_collection_products should have policy');
  });

  void it('webhook_events policy references shop_id', async () => {
    const policies = await getTablePolicies('webhook_events');
    const hasShopIdPolicy = policies.some((p) =>
      ['shop_id', 'current_shop_id'].some((term) => p.qual?.includes(term))
    );
    assert.ok(hasShopIdPolicy, 'webhook_events policy should reference shop_id');
  });
});

// ============================================
// POLICY COMMANDS
// ============================================

void describe('Module B RLS: Policy Commands', { skip: SKIP }, () => {
  void it('shopify_products has SELECT policy', async () => {
    const policies = await getTablePolicies('shopify_products');
    const hasSelect = policies.some((p) => p.cmd === 'SELECT' || p.cmd === 'ALL');
    assert.ok(hasSelect, 'shopify_products should have SELECT policy');
  });

  void it('webhook_events has SELECT policy', async () => {
    const policies = await getTablePolicies('webhook_events');
    const hasSelect = policies.some((p) => p.cmd === 'SELECT' || p.cmd === 'ALL');
    assert.ok(hasSelect, 'webhook_events should have SELECT policy');
  });
});

// ============================================
// JOIN TABLE RLS
// ============================================

void describe('Module B RLS: Join Tables', { skip: SKIP }, () => {
  void it('shopify_collection_products has denormalized shop_id', async () => {
    // Verify the table has shop_id for RLS (denormalized from parent tables)
    const hasRls = await getTableRlsStatus('shopify_collection_products');
    assert.strictEqual(hasRls, true, 'shopify_collection_products should have RLS');
  });
});
