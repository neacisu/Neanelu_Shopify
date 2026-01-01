/**
 * Module D (Part 1): PIM Core Schema Tests
 *
 * Tests for 8 PIM core tables:
 * - prod_taxonomy
 * - prod_sources
 * - prod_raw_harvest
 * - prod_extraction_sessions
 * - prod_master
 * - prod_specs_normalized
 * - prod_semantics
 * - prod_channel_mappings
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
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// PROD_TAXONOMY TABLE
// ============================================

void describe('Module D: prod_taxonomy table', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  void it('exists as a base table', async () => {
    const info = await getTableInfo('prod_taxonomy');
    assert.ok(info, 'prod_taxonomy table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('prod_taxonomy');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('parent_id'), 'should have parent_id');
    assert.ok(columnNames.includes('name'), 'should have name');
    assert.ok(columnNames.includes('slug'), 'should have slug');
    assert.ok(columnNames.includes('level'), 'should have level');
    assert.ok(columnNames.includes('breadcrumbs'), 'should have breadcrumbs');
  });

  void it('has required indexes', async () => {
    const indexes = await getTableIndexes('prod_taxonomy');
    const indexNames = indexes.map((i) => i.indexname);

    assert.ok(indexNames.includes('idx_taxonomy_parent'), 'should have parent index');
    assert.ok(indexNames.includes('idx_taxonomy_slug'), 'should have slug index');
  });

  void it('does NOT have RLS (global PIM data)', async () => {
    const hasRls = await getTableRlsStatus('prod_taxonomy');
    assert.strictEqual(hasRls, false, 'prod_taxonomy should NOT have RLS');
  });

  void it('has self-referencing FK for hierarchy', async () => {
    const constraints = await getTableConstraints('prod_taxonomy');
    const fk = constraints.find((c) => c.constraint_type === 'FOREIGN KEY');
    assert.ok(fk, 'should have foreign key for parent_id');
  });
});

// ============================================
// PROD_SOURCES TABLE
// ============================================

void describe('Module D: prod_sources table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('prod_sources');
    assert.ok(info, 'prod_sources table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('prod_sources');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('name'), 'should have name');
    assert.ok(columnNames.includes('source_type'), 'should have source_type');
    assert.ok(columnNames.includes('base_url'), 'should have base_url');
    assert.ok(columnNames.includes('priority'), 'should have priority');
    assert.ok(columnNames.includes('is_active'), 'should have is_active');
  });

  void it('does NOT have RLS (global PIM data)', async () => {
    const hasRls = await getTableRlsStatus('prod_sources');
    assert.strictEqual(hasRls, false, 'prod_sources should NOT have RLS');
  });
});

// ============================================
// PROD_RAW_HARVEST TABLE
// ============================================

void describe('Module D: prod_raw_harvest table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('prod_raw_harvest');
    assert.ok(info, 'prod_raw_harvest table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('prod_raw_harvest');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('source_id'), 'should have source_id');
    assert.ok(columnNames.includes('source_url'), 'should have source_url');
    assert.ok(columnNames.includes('raw_json'), 'should have raw_json');
    assert.ok(columnNames.includes('fetched_at'), 'should have fetched_at');
    assert.ok(columnNames.includes('content_hash'), 'should have content_hash');
  });

  void it('has JSONB raw_json column', async () => {
    const columns = await getTableColumns('prod_raw_harvest');
    const rawJson = columns.find((c) => c.column_name === 'raw_json');
    assert.ok(rawJson, 'raw_json column should exist');
    assert.strictEqual(rawJson?.udt_name, 'jsonb', 'raw_json should be jsonb');
  });

  void it('does NOT have RLS (global PIM data)', async () => {
    const hasRls = await getTableRlsStatus('prod_raw_harvest');
    assert.strictEqual(hasRls, false, 'prod_raw_harvest should NOT have RLS');
  });
});

// ============================================
// PROD_EXTRACTION_SESSIONS TABLE
// ============================================

void describe('Module D: prod_extraction_sessions table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('prod_extraction_sessions');
    assert.ok(info, 'prod_extraction_sessions table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('prod_extraction_sessions');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('harvest_id'), 'should have harvest_id');
    assert.ok(columnNames.includes('model_name'), 'should have model_name');
    assert.ok(columnNames.includes('extracted_specs'), 'should have extracted_specs');
    assert.ok(columnNames.includes('confidence_score'), 'should have confidence_score');
  });

  void it('does NOT have RLS (global PIM data)', async () => {
    const hasRls = await getTableRlsStatus('prod_extraction_sessions');
    assert.strictEqual(hasRls, false, 'prod_extraction_sessions should NOT have RLS');
  });
});

// ============================================
// PROD_MASTER TABLE
// ============================================

void describe('Module D: prod_master table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('prod_master');
    assert.ok(info, 'prod_master table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('prod_master');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('taxonomy_id'), 'should have taxonomy_id');
    assert.ok(columnNames.includes('canonical_title'), 'should have canonical_title');
    assert.ok(columnNames.includes('brand'), 'should have brand');
    assert.ok(columnNames.includes('manufacturer'), 'should have manufacturer');
    assert.ok(columnNames.includes('quality_score'), 'should have quality_score');
  });

  void it('has FK to prod_taxonomy', async () => {
    const constraints = await getTableConstraints('prod_master');
    const fk = constraints.find((c) => c.constraint_type === 'FOREIGN KEY');
    assert.ok(fk, 'should have foreign key to taxonomy');
  });

  void it('does NOT have RLS (global PIM data)', async () => {
    const hasRls = await getTableRlsStatus('prod_master');
    assert.strictEqual(hasRls, false, 'prod_master should NOT have RLS');
  });
});

// ============================================
// PROD_SPECS_NORMALIZED TABLE
// ============================================

void describe('Module D: prod_specs_normalized table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('prod_specs_normalized');
    assert.ok(info, 'prod_specs_normalized table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('prod_specs_normalized');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('product_id'), 'should have product_id');
    assert.ok(columnNames.includes('specs'), 'should have specs');
    assert.ok(columnNames.includes('version'), 'should have version');
    assert.ok(columnNames.includes('is_current'), 'should have is_current');
  });

  void it('does NOT have RLS (global PIM data)', async () => {
    const hasRls = await getTableRlsStatus('prod_specs_normalized');
    assert.strictEqual(hasRls, false, 'prod_specs_normalized should NOT have RLS');
  });
});

// ============================================
// PROD_SEMANTICS TABLE
// ============================================

void describe('Module D: prod_semantics table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('prod_semantics');
    assert.ok(info, 'prod_semantics table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('prod_semantics');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('product_id'), 'should have product_id');
    assert.ok(columnNames.includes('search_vector'), 'should have search_vector');
    assert.ok(columnNames.includes('keywords'), 'should have keywords');
    assert.ok(columnNames.includes('locale'), 'should have locale');
  });

  void it('has tsvector search_vector column', async () => {
    const columns = await getTableColumns('prod_semantics');
    const searchVector = columns.find((c) => c.column_name === 'search_vector');
    assert.ok(searchVector, 'search_vector column should exist');
    assert.strictEqual(searchVector?.udt_name, 'tsvector', 'search_vector should be tsvector');
  });

  void it('has GIN index on search_vector', async () => {
    const indexes = await getTableIndexes('prod_semantics');
    const ginIndex = indexes.find(
      (i) => i.indexdef.includes('gin') && i.indexdef.includes('search_vector')
    );
    assert.ok(ginIndex, 'should have GIN index on search_vector');
  });

  void it('does NOT have RLS (global PIM data)', async () => {
    const hasRls = await getTableRlsStatus('prod_semantics');
    assert.strictEqual(hasRls, false, 'prod_semantics should NOT have RLS');
  });
});

// ============================================
// PROD_CHANNEL_MAPPINGS TABLE
// ============================================

void describe('Module D: prod_channel_mappings table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('prod_channel_mappings');
    assert.ok(info, 'prod_channel_mappings table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('prod_channel_mappings');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('product_id'), 'should have product_id');
    assert.ok(columnNames.includes('channel'), 'should have channel');
    assert.ok(columnNames.includes('external_id'), 'should have external_id');
    assert.ok(columnNames.includes('sync_status'), 'should have sync_status');
  });

  void it('has RLS enabled (shop-specific mapping)', async () => {
    const hasRls = await getTableRlsStatus('prod_channel_mappings');
    assert.strictEqual(hasRls, true, 'prod_channel_mappings should have RLS enabled');
  });
});
