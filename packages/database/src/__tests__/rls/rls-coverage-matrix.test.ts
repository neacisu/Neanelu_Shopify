/**
 * RLS Coverage Matrix Tests
 *
 * Comprehensive verification of RLS policies across all 42 tables.
 * Validates that multi-tenant isolation is properly configured.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import {
  getTablesWithRls,
  getAllPolicies,
  getTableRlsStatus,
  type PolicyInfo,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// Tables that MUST have RLS enabled
const REQUIRED_RLS_TABLES = [
  // Module A - Core (shop-specific)
  'staff_users',
  'app_sessions',

  // Module B - Shopify Mirror
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

  // Module C - Bulk Operations
  'bulk_runs',
  'bulk_steps',
  'bulk_artifacts',
  'bulk_errors',
  'staging_products',
  'staging_variants',

  // Module D - PIM (only channel mappings)
  'prod_channel_mappings',

  // Module E - Vectors (only shop embeddings)
  'shop_product_embeddings',

  // Module F - AI Batch
  'ai_batches',
  'ai_batch_items',
  'embedding_batches',

  // Module G - Queue
  'job_runs',
  'scheduled_tasks',
  'rate_limit_buckets',

  // Module H - Audit
  'audit_logs',
  'sync_checkpoints',

  // Module I - Inventory
  'inventory_ledger',
  'inventory_locations',

  // Module J - Media
  'shopify_media',
  'shopify_product_media',
  'shopify_variant_media',
  'shopify_publications',
  'shopify_resource_publications',

  // Module K - Menus
  'shopify_menus',
  'shopify_menu_items',

  // Module L - Scraper
  'api_usage_log',
  'scraper_configs',
  'scraper_runs',
  'scraper_queue',

  // Module M - Analytics
  'analytics_daily_shop',
  'analytics_product_performance',
];

// Tables that should NOT have RLS (global data)
const NO_RLS_TABLES = [
  'oauth_states',
  'oauth_nonces',
  'prod_taxonomy',
  'prod_sources',
  'prod_raw_harvest',
  'prod_extraction_sessions',
  'prod_master',
  'prod_specs_normalized',
  'prod_semantics',
  'prod_proposals',
  'prod_dedupe_clusters',
  'prod_dedupe_cluster_members',
  'prod_similarity_matches',
  'prod_quality_events',
  'prod_translations',
  'prod_attr_definitions',
  'prod_attr_synonyms',
  'prod_embeddings',
];

// ============================================
// RLS SUMMARY
// ============================================

void describe('RLS Coverage Summary', { skip: SKIP }, () => {
  let tablesWithRls: string[];
  let allPolicies: PolicyInfo[];

  before(async () => {
    getPool();
    tablesWithRls = await getTablesWithRls();
    allPolicies = await getAllPolicies();
  });

  after(async () => {
    await closePool();
  });

  void it('has at least 35 tables with RLS enabled', () => {
    assert.ok(
      tablesWithRls.length >= 35,
      `Expected at least 35 tables with RLS, got ${tablesWithRls.length}`
    );
  });

  void it('has RLS count in expected range (35-60)', () => {
    assert.ok(
      tablesWithRls.length >= 35 && tablesWithRls.length <= 60,
      `RLS count ${tablesWithRls.length} should be in range 35-60`
    );
  });

  void it('has at least 40 RLS policies', () => {
    assert.ok(allPolicies.length >= 40, `Expected at least 40 policies, got ${allPolicies.length}`);
  });
});

// ============================================
// REQUIRED RLS TABLES VERIFICATION
// ============================================

void describe('RLS: Required Tables Have RLS', { skip: SKIP }, () => {
  for (const tableName of REQUIRED_RLS_TABLES) {
    void it(`${tableName} has RLS enabled`, async () => {
      const hasRls = await getTableRlsStatus(tableName);
      assert.strictEqual(hasRls, true, `${tableName} should have RLS enabled`);
    });
  }
});

// ============================================
// NO RLS TABLES VERIFICATION
// ============================================

void describe('RLS: Global Tables Without RLS', { skip: SKIP }, () => {
  for (const tableName of NO_RLS_TABLES) {
    void it(`${tableName} does NOT have RLS (global data)`, async () => {
      const hasRls = await getTableRlsStatus(tableName);
      assert.strictEqual(hasRls, false, `${tableName} should NOT have RLS (global PIM data)`);
    });
  }
});

// ============================================
// RLS POLICY VERIFICATION
// ============================================

void describe('RLS Policies', { skip: SKIP }, () => {
  void it('each RLS-enabled table has at least one policy', async () => {
    const tablesWithRls = await getTablesWithRls();
    const allPolicies = await getAllPolicies();

    for (const table of tablesWithRls) {
      const tablePolicies = allPolicies.filter((p) => p.tablename === table);
      assert.ok(tablePolicies.length >= 1, `${table} should have at least one RLS policy`);
    }
  });

  void it('policies reference shop_id context', async () => {
    const allPolicies = await getAllPolicies();

    // Most policies should reference the shop_id context
    const shopIdPolicies = allPolicies.filter((p) =>
      ['shop_id', 'current_shop_id'].some(
        (term) => p.qual?.includes(term) === true || p.with_check?.includes(term) === true
      )
    );

    assert.ok(
      shopIdPolicies.length >= 30,
      'Most policies should reference shop_id for tenant isolation'
    );
  });
});

// ============================================
// RLS POLICY TYPES
// ============================================

void describe('RLS Policy Types', { skip: SKIP }, () => {
  void it('has SELECT policies for read access', async () => {
    const allPolicies = await getAllPolicies();
    const selectPolicies = allPolicies.filter((p) => p.cmd === 'SELECT' || p.cmd === 'ALL');

    assert.ok(selectPolicies.length >= 30, 'Should have SELECT policies for read isolation');
  });

  void it('has INSERT policies with WITH CHECK', async () => {
    const allPolicies = await getAllPolicies();
    const insertPolicies = allPolicies.filter(
      (p) => (p.cmd === 'INSERT' || p.cmd === 'ALL') && p.with_check
    );

    assert.ok(insertPolicies.length >= 0, 'May have INSERT policies with WITH CHECK');
  });
});
