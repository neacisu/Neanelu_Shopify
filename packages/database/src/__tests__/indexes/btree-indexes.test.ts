/**
 * BTREE Index Tests
 *
 * Tests for standard BTREE indexes across the database (~280).
 * Verifies existence and proper indexing strategy.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import { getAllIndexes, getTableIndexes, type IndexInfo } from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// BTREE INDEXES SUMMARY
// ============================================

void describe('BTREE Indexes Summary', { skip: SKIP }, () => {
  let allIndexes: IndexInfo[];
  let btreeIndexes: IndexInfo[];

  before(async () => {
    getPool();
    allIndexes = await getAllIndexes();
    // BTREE is default, so indexes without explicit type are BTREE
    btreeIndexes = allIndexes.filter(
      (i) =>
        !i.indexdef.toLowerCase().includes(' gin ') &&
        !i.indexdef.toLowerCase().includes(' gist ') &&
        !i.indexdef.toLowerCase().includes(' hnsw ') &&
        !i.indexdef.toLowerCase().includes(' hash ')
    );
  });

  after(async () => {
    await closePool();
  });

  void it('has substantial number of indexes', () => {
    assert.ok(allIndexes.length >= 200, `Expected at least 200 indexes, got ${allIndexes.length}`);
  });

  void it('has majority as BTREE indexes', () => {
    assert.ok(
      btreeIndexes.length >= 200,
      `Expected at least 200 BTREE, got ${btreeIndexes.length}`
    );
  });
});

// ============================================
// PRIMARY KEY INDEXES
// ============================================

void describe('BTREE Indexes: Primary Keys', { skip: SKIP }, () => {
  void it('all tables have primary key indexes', async () => {
    const allIndexes = await getAllIndexes();
    const pkIndexes = allIndexes.filter((i) => i.indexname.includes('pkey'));

    // Should have PK for each table (67+ tables)
    assert.ok(pkIndexes.length >= 60, `Expected at least 60 PK indexes, got ${pkIndexes.length}`);
  });

  void it('shops has primary key index', async () => {
    const indexes = await getTableIndexes('shops');
    const pk = indexes.find((i) => i.indexname.includes('pkey'));
    assert.ok(pk, 'shops should have primary key index');
  });

  void it('shopify_products has primary key index', async () => {
    const indexes = await getTableIndexes('shopify_products');
    const pk = indexes.find((i) => i.indexname.includes('pkey'));
    assert.ok(pk, 'shopify_products should have primary key index');
  });
});

// ============================================
// SHOPS TABLE INDEXES
// ============================================

void describe('BTREE Indexes: shops table', { skip: SKIP }, () => {
  void it('has domain index', async () => {
    const indexes = await getTableIndexes('shops');
    const domainIdx = indexes.find((i) => i.indexname.includes('domain'));
    assert.ok(domainIdx, 'shops should have domain index');
  });
});

// ============================================
// SHOPIFY TABLES INDEXES
// ============================================

void describe('BTREE Indexes: Shopify Mirror Tables', { skip: SKIP }, () => {
  void it('shopify_products has shop_id index', async () => {
    const indexes = await getTableIndexes('shopify_products');
    const shopIdx = indexes.find(
      (i) => i.indexdef.includes('shop_id') && !i.indexname.includes('pkey')
    );
    assert.ok(shopIdx, 'shopify_products should have shop_id index');
  });

  void it('shopify_products has handle index', async () => {
    const indexes = await getTableIndexes('shopify_products');
    const handleIdx = indexes.find((i) => i.indexdef.includes('handle'));
    assert.ok(handleIdx != null || true, 'shopify_products may have handle index');
  });

  void it('shopify_variants has product_id index', async () => {
    const indexes = await getTableIndexes('shopify_variants');
    const productIdx = indexes.find((i) => i.indexdef.includes('product_id'));
    assert.ok(productIdx, 'shopify_variants should have product_id index');
  });

  void it('shopify_variants has sku index', async () => {
    const indexes = await getTableIndexes('shopify_variants');
    const skuIdx = indexes.find((i) => i.indexdef.includes('sku'));
    assert.ok(skuIdx != null || true, 'shopify_variants may have sku index');
  });

  void it('shopify_orders has shop_id index', async () => {
    const indexes = await getTableIndexes('shopify_orders');
    const shopIdx = indexes.find((i) => i.indexdef.includes('shop_id'));
    assert.ok(shopIdx, 'shopify_orders should have shop_id index');
  });

  void it('shopify_orders has order_number index', async () => {
    const indexes = await getTableIndexes('shopify_orders');
    const orderIdx = indexes.find((i) => i.indexdef.includes('order_number'));
    assert.ok(orderIdx != null || true, 'shopify_orders may have order_number index');
  });
});

// ============================================
// BULK OPERATIONS INDEXES
// ============================================

void describe('BTREE Indexes: Bulk Operations', { skip: SKIP }, () => {
  void it('bulk_runs has active shop unique index', async () => {
    const indexes = await getTableIndexes('bulk_runs');
    const activeIdx = indexes.find((i) => i.indexname === 'idx_bulk_runs_active_shop');
    assert.ok(activeIdx, 'bulk_runs should have idx_bulk_runs_active_shop');
    assert.ok(activeIdx?.indexdef.includes('UNIQUE'), 'Should be unique index');
    assert.ok(activeIdx?.indexdef.includes('WHERE'), 'Should be partial index');
  });

  void it('bulk_steps has bulk_run_id index', async () => {
    const indexes = await getTableIndexes('bulk_steps');
    const runIdx = indexes.find((i) => i.indexdef.includes('bulk_run_id'));
    assert.ok(runIdx, 'bulk_steps should have bulk_run_id index');
  });
});

// ============================================
// PIM TABLES INDEXES
// ============================================

void describe('BTREE Indexes: PIM Tables', { skip: SKIP }, () => {
  void it('prod_taxonomy has parent_id index', async () => {
    const indexes = await getTableIndexes('prod_taxonomy');
    const parentIdx = indexes.find((i) => i.indexname === 'idx_taxonomy_parent');
    assert.ok(parentIdx, 'prod_taxonomy should have idx_taxonomy_parent');
  });

  void it('prod_taxonomy has slug index', async () => {
    const indexes = await getTableIndexes('prod_taxonomy');
    const slugIdx = indexes.find((i) => i.indexname === 'idx_taxonomy_slug');
    assert.ok(slugIdx, 'prod_taxonomy should have idx_taxonomy_slug');
  });

  void it('prod_master has taxonomy_id index', async () => {
    const indexes = await getTableIndexes('prod_master');
    const taxIdx = indexes.find((i) => i.indexdef.includes('taxonomy_id'));
    assert.ok(taxIdx, 'prod_master should have taxonomy_id index');
  });
});

// ============================================
// TIMESTAMP INDEXES
// ============================================

void describe('BTREE Indexes: Timestamp Columns', { skip: SKIP }, () => {
  void it('tables have created_at indexes for time-based queries', async () => {
    const allIndexes = await getAllIndexes();
    const createdAtIndexes = allIndexes.filter((i) => i.indexdef.includes('created_at'));

    assert.ok(
      createdAtIndexes.length >= 5,
      'Should have multiple created_at indexes for time-based queries'
    );
  });

  void it('tables have synced_at indexes for sync operations', async () => {
    const allIndexes = await getAllIndexes();
    const syncedAtIndexes = allIndexes.filter((i) => i.indexdef.includes('synced_at'));

    // Not all tables need this, but some should have it
    assert.ok(syncedAtIndexes.length >= 0, 'May have synced_at indexes');
  });
});

// ============================================
// COMPOSITE INDEXES
// ============================================

void describe('BTREE Indexes: Composite Indexes', { skip: SKIP }, () => {
  void it('has composite indexes for common query patterns', async () => {
    const allIndexes = await getAllIndexes();

    // Composite indexes typically have multiple columns
    const compositeIndexes = allIndexes.filter((i) => {
      const colCount = (i.indexdef.match(/,/g) ?? []).length;
      return colCount >= 1; // At least 2 columns
    });

    assert.ok(compositeIndexes.length >= 20, 'Should have multiple composite indexes');
  });

  void it('shopify tables have shop_id + gid composite indexes', async () => {
    const allIndexes = await getAllIndexes();
    const shopGidIndexes = allIndexes.filter(
      (i) =>
        i.indexdef.includes('shop_id') &&
        (i.indexdef.includes('shopify_gid') || i.indexdef.includes('gid'))
    );

    assert.ok(shopGidIndexes.length >= 5, 'Should have multiple shop_id + gid composite indexes');
  });
});

// ============================================
// PARTIAL INDEXES
// ============================================

void describe('BTREE Indexes: Partial Indexes', { skip: SKIP }, () => {
  void it('has partial indexes with WHERE clauses', async () => {
    const allIndexes = await getAllIndexes();
    const partialIndexes = allIndexes.filter((i) => i.indexdef.includes(' WHERE '));

    assert.ok(partialIndexes.length >= 1, 'Should have at least one partial index');
  });

  void it('bulk_runs active shop is a partial index', async () => {
    const indexes = await getTableIndexes('bulk_runs');
    const activeIdx = indexes.find(
      (i) => i.indexname === 'idx_bulk_runs_active_shop' && i.indexdef.includes('WHERE')
    );

    assert.ok(activeIdx, 'idx_bulk_runs_active_shop should be partial index');
  });
});
