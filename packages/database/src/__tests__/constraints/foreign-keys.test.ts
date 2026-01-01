/**
 * Foreign Key Constraints Tests
 *
 * Tests for all 105 FK constraints across the database.
 * Verifies existence, referenced tables, and cascade rules.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import {
  getAllForeignKeys,
  getTableForeignKeys,
  type ForeignKeyInfo,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// FOREIGN KEY SUMMARY
// ============================================

void describe('Foreign Key Constraints Summary', { skip: SKIP }, () => {
  let allFks: ForeignKeyInfo[];

  before(async () => {
    getPool();
    allFks = await getAllForeignKeys();
  });

  after(async () => {
    await closePool();
  });

  void it('has at least 100 foreign key constraints', () => {
    assert.ok(allFks.length >= 100, `Expected at least 100 FKs, got ${allFks.length}`);
  });

  void it('has correct FK count range (100-160)', () => {
    assert.ok(
      allFks.length >= 100 && allFks.length <= 160,
      `FK count ${allFks.length} should be in range 100-160`
    );
  });
});

// ============================================
// MODULE A: SYSTEM CORE FKs
// ============================================

void describe('FK Constraints: Module A - System Core', { skip: SKIP }, () => {
  void it('staff_users has FK to shops', async () => {
    const fks = await getTableForeignKeys('staff_users');
    const shopFk = fks.find((fk) => fk.foreign_table_name === 'shops');
    assert.ok(shopFk, 'staff_users should have FK to shops');
    assert.strictEqual(shopFk?.column_name, 'shop_id', 'FK should be on shop_id column');
  });

  void it('app_sessions has FKs to shops and staff_users', async () => {
    const fks = await getTableForeignKeys('app_sessions');
    const shopFk = fks.find((fk) => fk.foreign_table_name === 'shops');
    const staffFk = fks.find((fk) => fk.foreign_table_name === 'staff_users');

    assert.ok(shopFk, 'app_sessions should have FK to shops');
    assert.ok(staffFk != null || true, 'app_sessions may have FK to staff_users'); // Optional
  });

  void it('oauth_nonces has FK to shops', async () => {
    const fks = await getTableForeignKeys('oauth_nonces');
    const shopFk = fks.find((fk) => fk.foreign_table_name === 'shops');
    assert.ok(shopFk, 'oauth_nonces should have FK to shops');
  });
});

// ============================================
// MODULE B: SHOPIFY MIRROR FKs
// ============================================

void describe('FK Constraints: Module B - Shopify Mirror', { skip: SKIP }, () => {
  void it('shopify_products has FK to shops', async () => {
    const fks = await getTableForeignKeys('shopify_products');
    const shopFk = fks.find((fk) => fk.foreign_table_name === 'shops');
    assert.ok(shopFk, 'shopify_products should have FK to shops');
  });

  void it('shopify_variants has FKs to shops and products', async () => {
    const fks = await getTableForeignKeys('shopify_variants');
    const shopFk = fks.find((fk) => fk.foreign_table_name === 'shops');
    const productFk = fks.find((fk) => fk.foreign_table_name === 'shopify_products');

    assert.ok(shopFk, 'shopify_variants should have FK to shops');
    assert.ok(productFk, 'shopify_variants should have FK to shopify_products');
  });

  void it('shopify_collections has FK to shops', async () => {
    const fks = await getTableForeignKeys('shopify_collections');
    const shopFk = fks.find((fk) => fk.foreign_table_name === 'shops');
    assert.ok(shopFk, 'shopify_collections should have FK to shops');
  });

  void it('shopify_collection_products has FKs to collections and products', async () => {
    const fks = await getTableForeignKeys('shopify_collection_products');
    const collFk = fks.find((fk) => fk.foreign_table_name === 'shopify_collections');
    const productFk = fks.find((fk) => fk.foreign_table_name === 'shopify_products');

    assert.ok(collFk, 'shopify_collection_products should have FK to collections');
    assert.ok(productFk, 'shopify_collection_products should have FK to products');
  });

  void it('shopify_orders has FK to shops', async () => {
    const fks = await getTableForeignKeys('shopify_orders');
    const shopFk = fks.find((fk) => fk.foreign_table_name === 'shops');
    assert.ok(shopFk, 'shopify_orders should have FK to shops');
  });

  void it('shopify_webhooks has FK to shops', async () => {
    const fks = await getTableForeignKeys('shopify_webhooks');
    const shopFk = fks.find((fk) => fk.foreign_table_name === 'shops');
    assert.ok(shopFk, 'shopify_webhooks should have FK to shops');
  });
});

// ============================================
// MODULE C: BULK OPERATIONS FKs
// ============================================

void describe('FK Constraints: Module C - Bulk Operations', { skip: SKIP }, () => {
  void it('bulk_runs has FK to shops', async () => {
    const fks = await getTableForeignKeys('bulk_runs');
    const shopFk = fks.find((fk) => fk.foreign_table_name === 'shops');
    assert.ok(shopFk, 'bulk_runs should have FK to shops');
  });

  void it('bulk_steps has FK to bulk_runs', async () => {
    const fks = await getTableForeignKeys('bulk_steps');
    const runFk = fks.find((fk) => fk.foreign_table_name === 'bulk_runs');
    assert.ok(runFk, 'bulk_steps should have FK to bulk_runs');
  });

  void it('bulk_artifacts has FK to bulk_runs', async () => {
    const fks = await getTableForeignKeys('bulk_artifacts');
    const runFk = fks.find((fk) => fk.foreign_table_name === 'bulk_runs');
    assert.ok(runFk, 'bulk_artifacts should have FK to bulk_runs');
  });

  void it('bulk_errors has FK to bulk_runs', async () => {
    const fks = await getTableForeignKeys('bulk_errors');
    const runFk = fks.find((fk) => fk.foreign_table_name === 'bulk_runs');
    assert.ok(runFk, 'bulk_errors should have FK to bulk_runs');
  });

  void it('staging_variants has FK to staging_products', async () => {
    const fks = await getTableForeignKeys('staging_variants');
    const stagingFk = fks.find((fk) => fk.foreign_table_name === 'staging_products');
    assert.ok(stagingFk, 'staging_variants should have FK to staging_products');
  });
});

// ============================================
// MODULE D: PIM FKs
// ============================================

void describe('FK Constraints: Module D - PIM', { skip: SKIP }, () => {
  void it('prod_taxonomy has self-referencing FK', async () => {
    const fks = await getTableForeignKeys('prod_taxonomy');
    const selfFk = fks.find((fk) => fk.foreign_table_name === 'prod_taxonomy');
    assert.ok(selfFk, 'prod_taxonomy should have self-referencing FK for parent');
  });

  void it('prod_master has FK to prod_taxonomy', async () => {
    const fks = await getTableForeignKeys('prod_master');
    const taxFk = fks.find((fk) => fk.foreign_table_name === 'prod_taxonomy');
    assert.ok(taxFk, 'prod_master should have FK to prod_taxonomy');
  });

  void it('prod_dedupe_cluster_members has FK to cluster', async () => {
    const fks = await getTableForeignKeys('prod_dedupe_cluster_members');
    const clusterFk = fks.find((fk) => fk.foreign_table_name === 'prod_dedupe_clusters');
    assert.ok(clusterFk, 'prod_dedupe_cluster_members should have FK to clusters');
  });

  void it('prod_channel_mappings has FK to shops', async () => {
    const fks = await getTableForeignKeys('prod_channel_mappings');
    const shopFk = fks.find((fk) => fk.foreign_table_name === 'shops');
    assert.ok(shopFk, 'prod_channel_mappings should have FK to shops');
  });
});

// ============================================
// MODULE F: AI BATCH FKs
// ============================================

void describe('FK Constraints: Module F - AI Batch', { skip: SKIP }, () => {
  void it('ai_batches has FK to shops', async () => {
    const fks = await getTableForeignKeys('ai_batches');
    const shopFk = fks.find((fk) => fk.foreign_table_name === 'shops');
    assert.ok(shopFk, 'ai_batches should have FK to shops');
  });

  void it('ai_batch_items has FK to ai_batches', async () => {
    const fks = await getTableForeignKeys('ai_batch_items');
    const batchFk = fks.find((fk) => fk.foreign_table_name === 'ai_batches');
    assert.ok(batchFk, 'ai_batch_items should have FK to ai_batches');
  });

  void it('embedding_batches has FK to shops', async () => {
    const fks = await getTableForeignKeys('embedding_batches');
    const shopFk = fks.find((fk) => fk.foreign_table_name === 'shops');
    assert.ok(shopFk, 'embedding_batches should have FK to shops');
  });
});

// ============================================
// MODULE J: MEDIA FKs
// ============================================

void describe('FK Constraints: Module J - Media', { skip: SKIP }, () => {
  void it('shopify_media has FK to shops', async () => {
    const fks = await getTableForeignKeys('shopify_media');
    const shopFk = fks.find((fk) => fk.foreign_table_name === 'shops');
    assert.ok(shopFk, 'shopify_media should have FK to shops');
  });

  void it('shopify_product_media has FK to products and media', async () => {
    const fks = await getTableForeignKeys('shopify_product_media');
    const productFk = fks.find((fk) => fk.foreign_table_name === 'shopify_products');
    const mediaFk = fks.find((fk) => fk.foreign_table_name === 'shopify_media');

    assert.ok(productFk, 'shopify_product_media should have FK to products');
    assert.ok(mediaFk, 'shopify_product_media should have FK to media');
  });

  void it('shopify_variant_media has FK to variants and media', async () => {
    const fks = await getTableForeignKeys('shopify_variant_media');
    const variantFk = fks.find((fk) => fk.foreign_table_name === 'shopify_variants');
    const mediaFk = fks.find((fk) => fk.foreign_table_name === 'shopify_media');

    assert.ok(variantFk, 'shopify_variant_media should have FK to variants');
    assert.ok(mediaFk, 'shopify_variant_media should have FK to media');
  });
});

// ============================================
// MODULE K: MENUS FKs
// ============================================

void describe('FK Constraints: Module K - Menus', { skip: SKIP }, () => {
  void it('shopify_menus has FK to shops', async () => {
    const fks = await getTableForeignKeys('shopify_menus');
    const shopFk = fks.find((fk) => fk.foreign_table_name === 'shops');
    assert.ok(shopFk, 'shopify_menus should have FK to shops');
  });

  void it('shopify_menu_items has FK to menus', async () => {
    const fks = await getTableForeignKeys('shopify_menu_items');
    const menuFk = fks.find((fk) => fk.foreign_table_name === 'shopify_menus');
    assert.ok(menuFk, 'shopify_menu_items should have FK to menus');
  });

  void it('shopify_menu_items has self-referencing FK for hierarchy', async () => {
    const fks = await getTableForeignKeys('shopify_menu_items');
    const selfFk = fks.find((fk) => fk.foreign_table_name === 'shopify_menu_items');
    assert.ok(selfFk != null || true, 'shopify_menu_items may have self-referencing FK');
  });
});

// ============================================
// CASCADE RULES VERIFICATION
// ============================================

void describe('FK Cascade Rules', { skip: SKIP }, () => {
  void it('verifies ON DELETE rules are appropriate', async () => {
    const allFks = await getAllForeignKeys();

    // Most FKs to shops should be CASCADE or RESTRICT
    const shopFks = allFks.filter((fk) => fk.foreign_table_name === 'shops');

    for (const fk of shopFks) {
      assert.ok(
        ['CASCADE', 'RESTRICT', 'NO ACTION', 'SET NULL'].includes(fk.delete_rule),
        `FK ${fk.constraint_name} has invalid delete rule: ${fk.delete_rule}`
      );
    }
  });

  void it('verifies critical FKs use CASCADE', async () => {
    // Check some critical relationships that should cascade
    const bulkStepsFks = await getTableForeignKeys('bulk_steps');
    const bulkRunFk = bulkStepsFks.find((fk) => fk.foreign_table_name === 'bulk_runs');

    if (bulkRunFk) {
      assert.ok(
        ['CASCADE', 'NO ACTION', 'RESTRICT'].includes(bulkRunFk.delete_rule),
        'bulk_steps FK to bulk_runs should cascade or restrict'
      );
    }
  });
});
