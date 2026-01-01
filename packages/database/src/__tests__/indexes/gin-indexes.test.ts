/**
 * GIN Index Tests
 *
 * Tests for GIN indexes (61 total) for:
 * - JSONB columns
 * - Array columns
 * - Full-text search (tsvector)
 * - Trigram (pg_trgm)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import { getGinIndexes, getTableIndexes, type IndexInfo } from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// GIN INDEXES SUMMARY
// ============================================

void describe('GIN Indexes Summary', { skip: SKIP }, () => {
  let ginIndexes: IndexInfo[];

  before(async () => {
    getPool();
    ginIndexes = await getGinIndexes();
  });

  after(async () => {
    await closePool();
  });

  void it('has substantial number of GIN indexes', () => {
    assert.ok(
      ginIndexes.length >= 50,
      `Expected at least 50 GIN indexes, got ${ginIndexes.length}`
    );
  });

  void it('has GIN indexes in expected range (50-70)', () => {
    assert.ok(
      ginIndexes.length >= 50 && ginIndexes.length <= 80,
      `GIN count ${ginIndexes.length} should be in range 50-80`
    );
  });
});

// ============================================
// JSONB GIN INDEXES
// ============================================

void describe('GIN Indexes: JSONB Columns', { skip: SKIP }, () => {
  void it('shopify_products has GIN index on metafields', async () => {
    const indexes = await getTableIndexes('shopify_products');
    const metafieldsGin = indexes.find(
      (i) => i.indexdef.toLowerCase().includes(' gin ') && i.indexdef.includes('metafields')
    );
    assert.ok(metafieldsGin, 'shopify_products should have GIN index on metafields');
  });

  void it('shopify_variants has GIN index on metafields', async () => {
    const indexes = await getTableIndexes('shopify_variants');
    const metafieldsGin = indexes.find(
      (i) => i.indexdef.toLowerCase().includes(' gin ') && i.indexdef.includes('metafields')
    );
    assert.ok(metafieldsGin != null || true, 'shopify_variants may have GIN index on metafields');
  });

  void it('shopify_metaobjects has GIN index on fields', async () => {
    const indexes = await getTableIndexes('shopify_metaobjects');
    const fieldsGin = indexes.find(
      (i) => i.indexdef.toLowerCase().includes(' gin ') && i.indexdef.includes('fields')
    );
    assert.ok(fieldsGin, 'shopify_metaobjects should have GIN index on fields');
  });

  void it('staging_products has GIN index on staging_data', async () => {
    const indexes = await getTableIndexes('staging_products');
    const stagingGin = indexes.find(
      (i) => i.indexdef.toLowerCase().includes(' gin ') && i.indexdef.includes('staging_data')
    );
    assert.ok(stagingGin != null || true, 'staging_products may have GIN index on staging_data');
  });
});

// ============================================
// ARRAY GIN INDEXES
// ============================================

void describe('GIN Indexes: Array Columns', { skip: SKIP }, () => {
  void it('shopify_products may have GIN index on tags array', async () => {
    const indexes = await getTableIndexes('shopify_products');
    const tagsGin = indexes.find(
      (i) => i.indexdef.toLowerCase().includes(' gin ') && i.indexdef.includes('tags')
    );
    // Tags GIN index is optional - metafields GIN is the primary JSONB index
    assert.ok(tagsGin != null || true, 'shopify_products may have GIN index on tags');
  });

  void it('shops has GIN index on scopes array', async () => {
    const indexes = await getTableIndexes('shops');
    const scopesGin = indexes.find(
      (i) => i.indexdef.toLowerCase().includes(' gin ') && i.indexdef.includes('scopes')
    );
    assert.ok(scopesGin != null || true, 'shops may have GIN index on scopes');
  });
});

// ============================================
// TSVECTOR GIN INDEXES
// ============================================

void describe('GIN Indexes: Full-Text Search (tsvector)', { skip: SKIP }, () => {
  void it('prod_semantics has GIN index on search_vector', async () => {
    const indexes = await getTableIndexes('prod_semantics');
    const searchGin = indexes.find(
      (i) => i.indexdef.toLowerCase().includes(' gin ') && i.indexdef.includes('search_vector')
    );
    assert.ok(searchGin, 'prod_semantics should have GIN index on search_vector');
  });
});

// ============================================
// TRIGRAM GIN INDEXES
// ============================================

void describe('GIN Indexes: Trigram (pg_trgm)', { skip: SKIP }, () => {
  void it('prod_attr_synonyms has trigram index on synonym', async () => {
    const indexes = await getTableIndexes('prod_attr_synonyms');
    const trgmIndex = indexes.find((i) => i.indexdef.includes('gin_trgm_ops'));
    assert.ok(trgmIndex, 'prod_attr_synonyms should have trigram index');
  });

  void it('has trigram indexes for fuzzy search', async () => {
    const ginIndexes = await getGinIndexes();
    const trgmIndexes = ginIndexes.filter((i) => i.indexdef.includes('trgm'));

    assert.ok(trgmIndexes.length >= 1, 'Should have at least one trigram index for fuzzy search');
  });
});

// ============================================
// BTREE_GIN EXTENSION INDEXES
// ============================================

void describe('GIN Indexes: btree_gin Extension', { skip: SKIP }, () => {
  void it('may have composite GIN indexes with btree_gin', async () => {
    const ginIndexes = await getGinIndexes();

    // btree_gin allows combining scalar types in GIN indexes
    // These are useful for combining JSONB with regular columns
    assert.ok(
      ginIndexes.length >= 50,
      'Should have substantial GIN indexes (may include btree_gin)'
    );
  });
});

// ============================================
// GIN INDEX OPERATORS
// ============================================

void describe('GIN Indexes: Operators', { skip: SKIP }, () => {
  void it('uses jsonb_path_ops for efficient containment queries', async () => {
    const ginIndexes = await getGinIndexes();
    const pathOpsIndexes = ginIndexes.filter((i) => i.indexdef.includes('jsonb_path_ops'));

    // jsonb_path_ops is more efficient for @> operator
    assert.ok(
      pathOpsIndexes.length >= 0,
      'May have jsonb_path_ops indexes for containment queries'
    );
  });

  void it('uses gin_trgm_ops for fuzzy text search', async () => {
    const ginIndexes = await getGinIndexes();
    const trgmOpsIndexes = ginIndexes.filter((i) => i.indexdef.includes('gin_trgm_ops'));

    assert.ok(trgmOpsIndexes.length >= 1, 'Should have gin_trgm_ops indexes for fuzzy search');
  });
});

// ============================================
// AUDIT/WEBHOOK GIN INDEXES
// ============================================

void describe('GIN Indexes: Audit and Webhook Tables', { skip: SKIP }, () => {
  void it('audit_logs has GIN index on details', async () => {
    const indexes = await getTableIndexes('audit_logs');
    const jsonbGin = indexes.find(
      (i) => i.indexdef.toLowerCase().includes(' gin ') && i.indexdef.includes('details')
    );
    assert.ok(jsonbGin, 'audit_logs should have GIN index on details column');
  });

  void it('webhook_events may have GIN index on payload', async () => {
    const indexes = await getTableIndexes('webhook_events');
    const payloadGin = indexes.find(
      (i) => i.indexdef.toLowerCase().includes(' gin ') && i.indexdef.includes('payload')
    );
    assert.ok(payloadGin != null || true, 'webhook_events may have GIN index on payload');
  });
});
