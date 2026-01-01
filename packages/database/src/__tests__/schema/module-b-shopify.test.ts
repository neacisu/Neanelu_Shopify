/**
 * Module B: Shopify Mirror Schema Tests
 *
 * Tests for 10 Shopify mirror tables:
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
import {
  getTableInfo,
  getTableColumns,
  getTableIndexes,
  getTableRlsStatus,
  getTableConstraints,
  getTablePartitions,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// SHOPIFY_PRODUCTS TABLE
// ============================================

void describe('Module B: shopify_products table', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  void it('exists as a base table', async () => {
    const info = await getTableInfo('shopify_products');
    assert.ok(info, 'shopify_products table should exist');
  });

  void it('has all required columns with correct types', async () => {
    const columns = await getTableColumns('shopify_products');
    const columnMap = new Map(columns.map((c) => [c.column_name, c]));

    // Primary key
    assert.ok(columnMap.has('id'), 'should have id');
    assert.strictEqual(columnMap.get('id')?.udt_name, 'uuid', 'id should be uuid');

    // Shop reference
    assert.ok(columnMap.has('shop_id'), 'should have shop_id');
    assert.strictEqual(columnMap.get('shop_id')?.udt_name, 'uuid', 'shop_id should be uuid');

    // Shopify identifiers
    assert.ok(columnMap.has('shopify_gid'), 'should have shopify_gid');
    assert.ok(columnMap.has('legacy_resource_id'), 'should have legacy_resource_id');

    // Product data
    assert.ok(columnMap.has('title'), 'should have title');
    assert.ok(columnMap.has('handle'), 'should have handle');
    assert.ok(columnMap.has('status'), 'should have status');
    assert.ok(columnMap.has('product_type'), 'should have product_type');
    assert.ok(columnMap.has('vendor'), 'should have vendor');
    assert.ok(columnMap.has('tags'), 'should have tags');

    // JSONB fields
    assert.ok(columnMap.has('metafields'), 'should have metafields');
    assert.strictEqual(
      columnMap.get('metafields')?.udt_name,
      'jsonb',
      'metafields should be jsonb'
    );

    // Timestamps
    assert.ok(columnMap.has('created_at'), 'should have created_at');
    assert.ok(columnMap.has('updated_at'), 'should have updated_at');
    assert.ok(columnMap.has('synced_at'), 'should have synced_at');
  });

  void it('has required indexes', async () => {
    const indexes = await getTableIndexes('shopify_products');
    const indexNames = indexes.map((i) => i.indexname);

    assert.ok(
      indexNames.some((n) => n.includes('pkey')),
      'should have primary key index'
    );
    assert.ok(
      indexNames.some((n) => n.includes('shop_id') || n.includes('shopify_gid')),
      'should have index on shop_id or shopify_gid'
    );
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('shopify_products');
    assert.strictEqual(hasRls, true, 'shopify_products should have RLS enabled');
  });

  void it('has CHECK constraint on status', async () => {
    const constraints = await getTableConstraints('shopify_products');
    const checkConstraint = constraints.find((c) => c.constraint_name === 'chk_product_status');
    assert.ok(checkConstraint, 'chk_product_status constraint should exist');
  });
});

// ============================================
// SHOPIFY_VARIANTS TABLE
// ============================================

void describe('Module B: shopify_variants table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('shopify_variants');
    assert.ok(info, 'shopify_variants table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('shopify_variants');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('product_id'), 'should have product_id');
    assert.ok(columnNames.includes('shopify_gid'), 'should have shopify_gid');
    assert.ok(columnNames.includes('sku'), 'should have sku');
    assert.ok(columnNames.includes('barcode'), 'should have barcode');
    assert.ok(columnNames.includes('price'), 'should have price');
    assert.ok(columnNames.includes('compare_at_price'), 'should have compare_at_price');
    assert.ok(columnNames.includes('inventory_quantity'), 'should have inventory_quantity');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('shopify_variants');
    assert.strictEqual(hasRls, true, 'shopify_variants should have RLS enabled');
  });

  void it('has FK to shopify_products', async () => {
    const constraints = await getTableConstraints('shopify_variants');
    const fk = constraints.find((c) => c.constraint_type === 'FOREIGN KEY');
    assert.ok(fk, 'should have foreign key constraint');
  });
});

// ============================================
// SHOPIFY_COLLECTIONS TABLE
// ============================================

void describe('Module B: shopify_collections table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('shopify_collections');
    assert.ok(info, 'shopify_collections table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('shopify_collections');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('shopify_gid'), 'should have shopify_gid');
    assert.ok(columnNames.includes('title'), 'should have title');
    assert.ok(columnNames.includes('handle'), 'should have handle');
    assert.ok(columnNames.includes('collection_type'), 'should have collection_type');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('shopify_collections');
    assert.strictEqual(hasRls, true, 'shopify_collections should have RLS enabled');
  });
});

// ============================================
// SHOPIFY_COLLECTION_PRODUCTS TABLE
// ============================================

void describe('Module B: shopify_collection_products table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('shopify_collection_products');
    assert.ok(info, 'shopify_collection_products table should exist');
  });

  void it('has shop_id for RLS (denormalized)', async () => {
    const columns = await getTableColumns('shopify_collection_products');
    const columnNames = columns.map((c) => c.column_name);
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id for RLS');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('shopify_collection_products');
    assert.strictEqual(hasRls, true, 'shopify_collection_products should have RLS enabled');
  });
});

// ============================================
// SHOPIFY_ORDERS TABLE
// ============================================

void describe('Module B: shopify_orders table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('shopify_orders');
    assert.ok(info, 'shopify_orders table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('shopify_orders');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('shopify_gid'), 'should have shopify_gid');
    assert.ok(columnNames.includes('order_number'), 'should have order_number');
    assert.ok(columnNames.includes('total_price'), 'should have total_price');
    assert.ok(columnNames.includes('currency'), 'should have currency');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('shopify_orders');
    assert.strictEqual(hasRls, true, 'shopify_orders should have RLS enabled');
  });
});

// ============================================
// SHOPIFY_CUSTOMERS TABLE
// ============================================

void describe('Module B: shopify_customers table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('shopify_customers');
    assert.ok(info, 'shopify_customers table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('shopify_customers');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('shopify_gid'), 'should have shopify_gid');
    assert.ok(columnNames.includes('email'), 'should have email');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('shopify_customers');
    assert.strictEqual(hasRls, true, 'shopify_customers should have RLS enabled');
  });
});

// ============================================
// SHOPIFY_METAOBJECTS TABLE
// ============================================

void describe('Module B: shopify_metaobjects table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('shopify_metaobjects');
    assert.ok(info, 'shopify_metaobjects table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('shopify_metaobjects');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('shopify_gid'), 'should have shopify_gid');
    assert.ok(columnNames.includes('type'), 'should have type');
    assert.ok(columnNames.includes('handle'), 'should have handle');
    assert.ok(columnNames.includes('fields'), 'should have fields');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('shopify_metaobjects');
    assert.strictEqual(hasRls, true, 'shopify_metaobjects should have RLS enabled');
  });
});

// ============================================
// SHOPIFY_WEBHOOKS TABLE
// ============================================

void describe('Module B: shopify_webhooks table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('shopify_webhooks');
    assert.ok(info, 'shopify_webhooks table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('shopify_webhooks');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('shopify_id'), 'should have shopify_id');
    assert.ok(columnNames.includes('topic'), 'should have topic');
    assert.ok(columnNames.includes('address'), 'should have address');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('shopify_webhooks');
    assert.strictEqual(hasRls, true, 'shopify_webhooks should have RLS enabled');
  });
});

// ============================================
// WEBHOOK_EVENTS TABLE (PARTITIONED)
// ============================================

void describe('Module B: webhook_events table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('webhook_events');
    assert.ok(info, 'webhook_events table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('webhook_events');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('topic'), 'should have topic');
    assert.ok(columnNames.includes('payload'), 'should have payload');
    assert.ok(columnNames.includes('received_at'), 'should have received_at');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('webhook_events');
    assert.strictEqual(hasRls, true, 'webhook_events should have RLS enabled');
  });

  void it('is partitioned by month', async () => {
    const partitions = await getTablePartitions('webhook_events');
    assert.ok(partitions.length >= 12, 'should have at least 12 monthly partitions');
    assert.ok(
      partitions.some((p) => p.partition_name.includes('2025_01')),
      'should have 2025_01 partition'
    );
  });
});

// ============================================
// SHOPIFY_TOKENS TABLE
// ============================================

void describe('Module B: shopify_tokens table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('shopify_tokens');
    assert.ok(info, 'shopify_tokens table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('shopify_tokens');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('shopify_tokens');
    assert.strictEqual(hasRls, true, 'shopify_tokens should have RLS enabled');
  });
});
