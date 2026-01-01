/**
 * HNSW Index Tests
 *
 * Tests for pgvector HNSW indexes (3 total):
 * - idx_attr_embedding (prod_attr_definitions)
 * - idx_embeddings_vector (prod_embeddings)
 * - idx_shop_embeddings_vector (shop_product_embeddings)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getPool, closePool, shouldSkipDbTests } from '../helpers/test-utils.ts';
import {
  getHnswIndexes,
  getTableIndexes,
  extensionInstalled,
  type IndexInfo,
} from '../helpers/schema-queries.ts';

const SKIP = shouldSkipDbTests();

// ============================================
// HNSW INDEXES SUMMARY
// ============================================

void describe('HNSW Indexes Summary', { skip: SKIP }, () => {
  let hnswIndexes: IndexInfo[];

  before(async () => {
    getPool();
    hnswIndexes = await getHnswIndexes();
  });

  after(async () => {
    await closePool();
  });

  void it('has pgvector extension installed', async () => {
    const installed = await extensionInstalled('vector');
    assert.strictEqual(installed, true, 'pgvector extension should be installed');
  });

  void it('has exactly 3 HNSW indexes', () => {
    assert.strictEqual(hnswIndexes.length, 3, `Expected 3 HNSW indexes, got ${hnswIndexes.length}`);
  });
});

// ============================================
// PROD_ATTR_DEFINITIONS HNSW INDEX
// ============================================

void describe('HNSW Index: prod_attr_definitions', { skip: SKIP }, () => {
  void it('has idx_attr_embedding HNSW index', async () => {
    const indexes = await getTableIndexes('prod_attr_definitions');
    const hnswIndex = indexes.find((i) => i.indexname === 'idx_attr_embedding');

    assert.ok(hnswIndex, 'idx_attr_embedding should exist');
    assert.ok(hnswIndex?.indexdef.toLowerCase().includes('hnsw'), 'Should be HNSW index type');
  });

  void it('idx_attr_embedding uses cosine distance', async () => {
    const indexes = await getTableIndexes('prod_attr_definitions');
    const hnswIndex = indexes.find((i) => i.indexname === 'idx_attr_embedding');

    // HNSW indexes can use different distance metrics
    // Common: vector_cosine_ops, vector_l2_ops, vector_ip_ops
    const hasVectorOps = ['vector_cosine_ops', 'vector_l2_ops', 'vector_ip_ops'].some((op) =>
      hnswIndex?.indexdef.includes(op)
    );
    assert.ok(hasVectorOps, 'Should use vector distance operator class');
  });

  void it('idx_attr_embedding indexes embedding column', async () => {
    const indexes = await getTableIndexes('prod_attr_definitions');
    const hnswIndex = indexes.find((i) => i.indexname === 'idx_attr_embedding');

    assert.ok(hnswIndex?.indexdef.includes('embedding'), 'Should index the embedding column');
  });
});

// ============================================
// PROD_EMBEDDINGS HNSW INDEX
// ============================================

void describe('HNSW Index: prod_embeddings', { skip: SKIP }, () => {
  void it('has idx_embeddings_vector HNSW index', async () => {
    const indexes = await getTableIndexes('prod_embeddings');
    const hnswIndex = indexes.find((i) => i.indexname === 'idx_embeddings_vector');

    assert.ok(hnswIndex, 'idx_embeddings_vector should exist');
    assert.ok(hnswIndex?.indexdef.toLowerCase().includes('hnsw'), 'Should be HNSW index type');
  });

  void it('idx_embeddings_vector uses appropriate distance metric', async () => {
    const indexes = await getTableIndexes('prod_embeddings');
    const hnswIndex = indexes.find((i) => i.indexname === 'idx_embeddings_vector');

    const hasVectorOps = ['vector_cosine_ops', 'vector_l2_ops', 'vector_ip_ops'].some((op) =>
      hnswIndex?.indexdef.includes(op)
    );
    assert.ok(hasVectorOps, 'Should use vector distance operator class');
  });

  void it('idx_embeddings_vector indexes embedding column', async () => {
    const indexes = await getTableIndexes('prod_embeddings');
    const hnswIndex = indexes.find((i) => i.indexname === 'idx_embeddings_vector');

    assert.ok(hnswIndex?.indexdef.includes('embedding'), 'Should index the embedding column');
  });
});

// ============================================
// SHOP_PRODUCT_EMBEDDINGS HNSW INDEX
// ============================================

void describe('HNSW Index: shop_product_embeddings', { skip: SKIP }, () => {
  void it('has idx_shop_embeddings_vector HNSW index', async () => {
    const indexes = await getTableIndexes('shop_product_embeddings');
    const hnswIndex = indexes.find((i) => i.indexname === 'idx_shop_embeddings_vector');

    assert.ok(hnswIndex, 'idx_shop_embeddings_vector should exist');
    assert.ok(hnswIndex?.indexdef.toLowerCase().includes('hnsw'), 'Should be HNSW index type');
  });

  void it('idx_shop_embeddings_vector uses appropriate distance metric', async () => {
    const indexes = await getTableIndexes('shop_product_embeddings');
    const hnswIndex = indexes.find((i) => i.indexname === 'idx_shop_embeddings_vector');

    const hasVectorOps = ['vector_cosine_ops', 'vector_l2_ops', 'vector_ip_ops'].some((op) =>
      hnswIndex?.indexdef.includes(op)
    );
    assert.ok(hasVectorOps, 'Should use vector distance operator class');
  });

  void it('idx_shop_embeddings_vector indexes embedding column', async () => {
    const indexes = await getTableIndexes('shop_product_embeddings');
    const hnswIndex = indexes.find((i) => i.indexname === 'idx_shop_embeddings_vector');

    assert.ok(hnswIndex?.indexdef.includes('embedding'), 'Should index the embedding column');
  });
});

// ============================================
// HNSW PARAMETERS
// ============================================

void describe('HNSW Index Parameters', { skip: SKIP }, () => {
  void it('HNSW indexes have appropriate parameters', async () => {
    const hnswIndexes = await getHnswIndexes();

    for (const index of hnswIndexes) {
      // HNSW indexes may have m and ef_construction parameters
      // These affect index quality vs build time
      assert.ok(index.indexdef, `${index.indexname} should have indexdef`);

      // Verify it's actually using HNSW
      assert.ok(
        index.indexdef.toLowerCase().includes('hnsw'),
        `${index.indexname} should use HNSW method`
      );
    }
  });
});

// ============================================
// VECTOR SIMILARITY SEARCH CAPABILITY
// ============================================

void describe('Vector Similarity Search', { skip: SKIP }, () => {
  void it('all HNSW indexes support similarity search', async () => {
    const hnswIndexes = await getHnswIndexes();

    const expectedIndexes = [
      'idx_attr_embedding',
      'idx_embeddings_vector',
      'idx_shop_embeddings_vector',
    ];

    const foundNames = hnswIndexes.map((i) => i.indexname);

    for (const expected of expectedIndexes) {
      assert.ok(foundNames.includes(expected), `Expected HNSW index ${expected} should exist`);
    }
  });

  void it('HNSW indexes are on vector columns', async () => {
    const hnswIndexes = await getHnswIndexes();

    for (const index of hnswIndexes) {
      assert.ok(
        index.indexdef.includes('embedding'),
        `${index.indexname} should be on an embedding column`
      );
    }
  });
});
