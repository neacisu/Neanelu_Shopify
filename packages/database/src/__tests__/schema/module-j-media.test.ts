/**
 * Module J: Media Schema Tests
 *
 * Tests for 5 media-related tables:
 * - shopify_media
 * - shopify_product_media
 * - shopify_variant_media
 * - shopify_publications
 * - shopify_resource_publications
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import {
  getTableInfo,
  getTableColumns,
  getTableRlsStatus,
  getTableConstraints,
  getTableTriggers,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// SHOPIFY_MEDIA TABLE
// ============================================

void describe('Module J: shopify_media table (renamed from media_files)', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  void it('exists as a base table', async () => {
    const info = await getTableInfo('shopify_media');
    assert.ok(info, 'shopify_media table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('shopify_media');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('media_id'), 'should have media_id (PK)');
    // assert.ok(columnNames.includes('id'), 'should have id'); // no id column
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('shopify_gid'), 'should have shopify_gid');
    assert.ok(columnNames.includes('media_type'), 'should have media_type');
    assert.ok(columnNames.includes('alt'), 'should have alt');
    assert.ok(columnNames.includes('url'), 'should have url'); // src -> url
    assert.ok(columnNames.includes('width'), 'should have width');
    assert.ok(columnNames.includes('height'), 'should have height');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('shopify_media');
    assert.strictEqual(hasRls, true, 'shopify_media should have RLS enabled');
  });

  void it('has update_updated_at trigger', async () => {
    const triggers = await getTableTriggers('shopify_media');
    const updateTrigger = triggers.find((t) => t.trigger_name.includes('updated_at'));
    assert.ok(updateTrigger, 'should have update_updated_at trigger');
  });
});

// ============================================
// SHOPIFY_PRODUCT_MEDIA TABLE
// ============================================

void describe('Module J: shopify_product_media table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('shopify_product_media');
    assert.ok(info, 'shopify_product_media table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('shopify_product_media');
    const columnNames = columns.map((c) => c.column_name);

    // assert.ok(columnNames.includes('id'), 'should have id'); // Composite PK (product_id, media_id)
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('product_id'), 'should have product_id');
    assert.ok(columnNames.includes('media_id'), 'should have media_id');
    assert.ok(columnNames.includes('position'), 'should have position');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('shopify_product_media');
    assert.strictEqual(hasRls, true, 'shopify_product_media should have RLS enabled');
  });

  void it('has FK to shopify_products and shopify_media', async () => {
    const constraints = await getTableConstraints('shopify_product_media');
    const fks = constraints.filter((c) => c.constraint_type === 'FOREIGN KEY');
    assert.ok(fks.length >= 1, 'should have at least one foreign key');
  });
});

// ============================================
// SHOPIFY_VARIANT_MEDIA TABLE
// ============================================

void describe('Module J: shopify_variant_media table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('shopify_variant_media');
    assert.ok(info, 'shopify_variant_media table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('shopify_variant_media');
    const columnNames = columns.map((c) => c.column_name);

    // assert.ok(columnNames.includes('id'), 'should have id'); // Composite PK
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('variant_id'), 'should have variant_id');
    assert.ok(columnNames.includes('media_id'), 'should have media_id');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('shopify_variant_media');
    assert.strictEqual(hasRls, true, 'shopify_variant_media should have RLS enabled');
  });
});

// ============================================
// SHOPIFY_PUBLICATIONS TABLE
// ============================================

void describe('Module J: shopify_publications table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('shopify_publications');
    assert.ok(info, 'shopify_publications table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('shopify_publications');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('shopify_gid'), 'should have shopify_gid');
    assert.ok(columnNames.includes('name'), 'should have name');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('shopify_publications');
    assert.strictEqual(hasRls, true, 'shopify_publications should have RLS enabled');
  });

  void it('has update_updated_at trigger', async () => {
    const triggers = await getTableTriggers('shopify_publications');
    const updateTrigger = triggers.find((t) => t.trigger_name.includes('updated_at'));
    assert.ok(updateTrigger, 'should have update_updated_at trigger');
  });
});

// ============================================
// SHOPIFY_RESOURCE_PUBLICATIONS TABLE
// ============================================

void describe('Module J: shopify_resource_publications table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('shopify_resource_publications');
    assert.ok(info, 'shopify_resource_publications table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('shopify_resource_publications');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('publication_id'), 'should have publication_id');
    assert.ok(columnNames.includes('resource_type'), 'should have resource_type');
    assert.ok(columnNames.includes('resource_id'), 'should have resource_id');
    assert.ok(columnNames.includes('is_published'), 'should have is_published');
  });

  void it('has RLS enabled', async () => {
    const hasRls = await getTableRlsStatus('shopify_resource_publications');
    assert.strictEqual(hasRls, true, 'shopify_resource_publications should have RLS enabled');
  });

  void it('has update_updated_at trigger', async () => {
    const triggers = await getTableTriggers('shopify_resource_publications');
    const updateTrigger = triggers.find((t) => t.trigger_name.includes('updated_at'));
    assert.ok(updateTrigger, 'should have update_updated_at trigger');
  });
});
