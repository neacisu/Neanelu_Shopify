/**
 * Module E: Vectors Schema Tests
 *
 * Tests for 4 vector/embedding tables:
 * - prod_attr_definitions
 * - prod_attr_synonyms
 * - prod_embeddings
 * - shop_product_embeddings
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import {
  getTableInfo,
  getTableColumns,
  getTableIndexes,
  getTableRlsStatus,
  extensionInstalled,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// EXTENSION VERIFICATION
// ============================================

void describe('Module E: pgvector extension', { skip: SKIP }, () => {
  before(() => {
    getPool();
  });

  after(async () => {
    await closePool();
  });

  void it('has vector extension installed', async () => {
    const installed = await extensionInstalled('vector');
    assert.strictEqual(installed, true, 'pgvector extension should be installed');
  });

  void it('has pg_trgm extension installed', async () => {
    const installed = await extensionInstalled('pg_trgm');
    assert.strictEqual(installed, true, 'pg_trgm extension should be installed');
  });
});

// ============================================
// PROD_ATTR_DEFINITIONS TABLE
// ============================================

void describe('Module E: prod_attr_definitions table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('prod_attr_definitions');
    assert.ok(info, 'prod_attr_definitions table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('prod_attr_definitions');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('code'), 'should have code');
    assert.ok(columnNames.includes('label'), 'should have label');
    assert.ok(columnNames.includes('data_type'), 'should have data_type');
    assert.ok(columnNames.includes('embedding'), 'should have embedding');
  });

  void it('has vector embedding column', async () => {
    const columns = await getTableColumns('prod_attr_definitions');
    const embedding = columns.find((c) => c.column_name === 'embedding');
    assert.ok(embedding, 'embedding column should exist');
    assert.strictEqual(embedding?.udt_name, 'vector', 'embedding should be vector type');
  });

  void it('has HNSW index on embedding', async () => {
    const indexes = await getTableIndexes('prod_attr_definitions');
    const hnswIndex = indexes.find((i) => i.indexdef.toLowerCase().includes('hnsw'));
    assert.ok(hnswIndex, 'should have HNSW index on embedding');
  });

  void it('does NOT have RLS (global PIM data)', async () => {
    const hasRls = await getTableRlsStatus('prod_attr_definitions');
    assert.strictEqual(hasRls, false, 'prod_attr_definitions should NOT have RLS');
  });
});

// ============================================
// PROD_ATTR_SYNONYMS TABLE
// ============================================

void describe('Module E: prod_attr_synonyms table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('prod_attr_synonyms');
    assert.ok(info, 'prod_attr_synonyms table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('prod_attr_synonyms');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('definition_id'), 'should have definition_id');
    assert.ok(columnNames.includes('synonym_text'), 'should have synonym_text');
    assert.ok(columnNames.includes('locale'), 'should have locale');
  });

  void it('has trigram index on synonym', async () => {
    const indexes = await getTableIndexes('prod_attr_synonyms');
    const trgmIndex = indexes.find((i) => i.indexdef.includes('gin_trgm_ops'));
    assert.ok(trgmIndex, 'should have trigram index on synonym');
  });

  void it('does NOT have RLS (global PIM data)', async () => {
    const hasRls = await getTableRlsStatus('prod_attr_synonyms');
    assert.strictEqual(hasRls, false, 'prod_attr_synonyms should NOT have RLS');
  });
});

// ============================================
// PROD_EMBEDDINGS TABLE
// ============================================

void describe('Module E: prod_embeddings table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('prod_embeddings');
    assert.ok(info, 'prod_embeddings table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('prod_embeddings');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('product_id'), 'should have product_id');
    assert.ok(columnNames.includes('embedding_type'), 'should have embedding_type');
    assert.ok(columnNames.includes('embedding'), 'should have embedding');
    assert.ok(columnNames.includes('model_version'), 'should have model_version');
    assert.ok(columnNames.includes('dimensions'), 'should have dimensions');
  });

  void it('has vector embedding column', async () => {
    const columns = await getTableColumns('prod_embeddings');
    const embedding = columns.find((c) => c.column_name === 'embedding');
    assert.ok(embedding, 'embedding column should exist');
    assert.strictEqual(embedding?.udt_name, 'vector', 'embedding should be vector type');
  });

  void it('has HNSW index on embedding', async () => {
    const indexes = await getTableIndexes('prod_embeddings');
    const hnswIndex = indexes.find(
      (i) => i.indexname === 'idx_embeddings_vector' && i.indexdef.toLowerCase().includes('hnsw')
    );
    assert.ok(hnswIndex, 'should have idx_embeddings_vector HNSW index');
  });

  void it('does NOT have RLS (global PIM data)', async () => {
    const hasRls = await getTableRlsStatus('prod_embeddings');
    assert.strictEqual(hasRls, false, 'prod_embeddings should NOT have RLS');
  });
});

// ============================================
// SHOP_PRODUCT_EMBEDDINGS TABLE
// ============================================

void describe('Module E: shop_product_embeddings table', { skip: SKIP }, () => {
  void it('exists as a base table', async () => {
    const info = await getTableInfo('shop_product_embeddings');
    assert.ok(info, 'shop_product_embeddings table should exist');
  });

  void it('has all required columns', async () => {
    const columns = await getTableColumns('shop_product_embeddings');
    const columnNames = columns.map((c) => c.column_name);

    assert.ok(columnNames.includes('id'), 'should have id');
    assert.ok(columnNames.includes('shop_id'), 'should have shop_id');
    assert.ok(columnNames.includes('product_id'), 'should have product_id');
    assert.ok(columnNames.includes('embedding_type'), 'should have embedding_type');
    assert.ok(columnNames.includes('embedding'), 'should have embedding');
    assert.ok(columnNames.includes('model_version'), 'should have model_version');
  });

  void it('has vector embedding column', async () => {
    const columns = await getTableColumns('shop_product_embeddings');
    const embedding = columns.find((c) => c.column_name === 'embedding');
    assert.ok(embedding, 'embedding column should exist');
    assert.strictEqual(embedding?.udt_name, 'vector', 'embedding should be vector type');
  });

  void it('has HNSW index on embedding', async () => {
    const indexes = await getTableIndexes('shop_product_embeddings');
    const hnswIndex = indexes.find(
      (i) =>
        i.indexname === 'idx_shop_embeddings_vector' && i.indexdef.toLowerCase().includes('hnsw')
    );
    assert.ok(hnswIndex, 'should have idx_shop_embeddings_vector HNSW index');
  });

  void it('HAS RLS enabled (shop-specific)', async () => {
    const hasRls = await getTableRlsStatus('shop_product_embeddings');
    assert.strictEqual(hasRls, true, 'shop_product_embeddings SHOULD have RLS enabled');
  });
});
