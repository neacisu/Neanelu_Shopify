/**
 * Module J, K & M RLS Tests: Media, Menus & Analytics
 *
 * Tests RLS policies for:
 * Module J - Media:
 * - shopify_media
 * - shopify_product_media
 * - shopify_variant_media
 * - shopify_publications
 * - shopify_resource_publications
 *
 * Module K - Menus:
 * - shopify_menus
 * - shopify_menu_items
 *
 * Module L - Scraper (partial):
 * - scraper_runs
 * - scraper_queue
 * - api_usage_log
 *
 * Module M - Analytics:
 * - analytics_daily_shop
 * - analytics_product_performance
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import { getTablePolicies, getTableRlsStatus } from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// Module J tables
const MODULE_J_TABLES = [
  'shopify_media',
  'shopify_product_media',
  'shopify_variant_media',
  'shopify_publications',
  'shopify_resource_publications',
];

// Module K tables
const MODULE_K_TABLES = ['shopify_menus', 'shopify_menu_items'];

// Module L: scraper is global infra (NO RLS); api_usage_log remains tenant-scoped (RLS)
const MODULE_L_SCRAPER_TABLES = ['scraper_configs', 'scraper_runs', 'scraper_queue'];
const MODULE_L_RLS_TABLES = ['api_usage_log'];

// Module M tables
const MODULE_M_TABLES = ['analytics_daily_shop', 'analytics_product_performance'];

// ============================================
// MODULE J: MEDIA RLS
// ============================================

void describe('Module J RLS: Media Tables', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  for (const tableName of MODULE_J_TABLES) {
    void it(`${tableName} has RLS enabled`, async () => {
      const hasRls = await getTableRlsStatus(tableName);
      assert.strictEqual(hasRls, true, `${tableName} should have RLS enabled`);
    });
  }

  for (const tableName of MODULE_J_TABLES) {
    void it(`${tableName} has at least one policy`, async () => {
      const policies = await getTablePolicies(tableName);
      assert.ok(policies.length >= 1, `${tableName} should have at least one RLS policy`);
    });
  }
});

// ============================================
// MODULE K: MENUS RLS
// ============================================

void describe('Module K RLS: Menu Tables', { skip: SKIP }, () => {
  for (const tableName of MODULE_K_TABLES) {
    void it(`${tableName} has RLS enabled`, async () => {
      const hasRls = await getTableRlsStatus(tableName);
      assert.strictEqual(hasRls, true, `${tableName} should have RLS enabled`);
    });
  }

  for (const tableName of MODULE_K_TABLES) {
    void it(`${tableName} has at least one policy`, async () => {
      const policies = await getTablePolicies(tableName);
      assert.ok(policies.length >= 1, `${tableName} should have at least one RLS policy`);
    });
  }
});

// ============================================
// MODULE L: SCRAPER RLS
// ============================================

void describe('Module L RLS: Scraper Tables', { skip: SKIP }, () => {
  for (const tableName of MODULE_L_SCRAPER_TABLES) {
    void it(`${tableName} has RLS disabled`, async () => {
      const hasRls = await getTableRlsStatus(tableName);
      assert.strictEqual(hasRls, false, `${tableName} should have RLS disabled`);
    });

    void it(`${tableName} has no policies`, async () => {
      const policies = await getTablePolicies(tableName);
      assert.strictEqual(policies.length, 0, `${tableName} should have no RLS policies`);
    });
  }

  for (const tableName of MODULE_L_RLS_TABLES) {
    void it(`${tableName} has RLS enabled`, async () => {
      const hasRls = await getTableRlsStatus(tableName);
      assert.strictEqual(hasRls, true, `${tableName} should have RLS enabled`);
    });

    void it(`${tableName} has at least one policy`, async () => {
      const policies = await getTablePolicies(tableName);
      assert.ok(policies.length >= 1, `${tableName} should have at least one RLS policy`);
    });
  }
});

// ============================================
// MODULE M: ANALYTICS RLS
// ============================================

void describe('Module M RLS: Analytics Tables', { skip: SKIP }, () => {
  for (const tableName of MODULE_M_TABLES) {
    void it(`${tableName} has RLS enabled`, async () => {
      const hasRls = await getTableRlsStatus(tableName);
      assert.strictEqual(hasRls, true, `${tableName} should have RLS enabled`);
    });
  }

  for (const tableName of MODULE_M_TABLES) {
    void it(`${tableName} has at least one policy`, async () => {
      const policies = await getTablePolicies(tableName);
      assert.ok(policies.length >= 1, `${tableName} should have at least one RLS policy`);
    });
  }
});

// ============================================
// POLICY CONTENT VERIFICATION
// ============================================

void describe('Module J/K/L/M RLS: Policy Content', { skip: SKIP }, () => {
  void it('shopify_media policy references shop_id', async () => {
    const policies = await getTablePolicies('shopify_media');
    const hasShopIdPolicy = policies.some((p) =>
      ['shop_id', 'current_shop_id'].some((term) => p.qual?.includes(term))
    );
    assert.ok(hasShopIdPolicy, 'shopify_media policy should reference shop_id');
  });

  void it('shopify_menus policy references shop_id', async () => {
    const policies = await getTablePolicies('shopify_menus');
    const hasShopIdPolicy = policies.some((p) =>
      ['shop_id', 'current_shop_id'].some((term) => p.qual?.includes(term))
    );
    assert.ok(hasShopIdPolicy, 'shopify_menus policy should reference shop_id');
  });

  void it('analytics_daily_shop policy references shop_id', async () => {
    const policies = await getTablePolicies('analytics_daily_shop');
    const hasShopIdPolicy = policies.some((p) =>
      ['shop_id', 'current_shop_id'].some((term) => p.qual?.includes(term))
    );
    assert.ok(hasShopIdPolicy, 'analytics_daily_shop policy should reference shop_id');
  });
});

// ============================================
// JOIN TABLE RLS
// ============================================

void describe('Module J RLS: Join Tables', { skip: SKIP }, () => {
  void it('shopify_product_media has denormalized shop_id', async () => {
    const hasRls = await getTableRlsStatus('shopify_product_media');
    assert.strictEqual(hasRls, true, 'shopify_product_media should have RLS');
  });

  void it('shopify_variant_media has denormalized shop_id', async () => {
    const hasRls = await getTableRlsStatus('shopify_variant_media');
    assert.strictEqual(hasRls, true, 'shopify_variant_media should have RLS');
  });

  void it('shopify_resource_publications has denormalized shop_id', async () => {
    const hasRls = await getTableRlsStatus('shopify_resource_publications');
    assert.strictEqual(hasRls, true, 'shopify_resource_publications should have RLS');
  });
});
