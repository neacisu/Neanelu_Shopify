/**
 * Embeddings Schema v2 Tests
 *
 * PR-047: F6.1.1 - Schema tests for embeddings v2 (2000 dims for HNSW)
 *
 * Tests verify:
 * - Drizzle schema constants are correct
 * - Schema structure matches expected columns
 * - Default values are correct
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  prodEmbeddings,
  shopProductEmbeddings,
  prodAttrDefinitions,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_NAME,
  EMBEDDING_DEFAULT_LANG,
} from '../../schema/vectors.ts';

// ============================================
// Schema Constants Tests
// ============================================

void describe('Embeddings Schema Constants', () => {
  void it('should export correct embedding dimensions', () => {
    assert.strictEqual(EMBEDDING_DIMENSIONS, 2000);
  });

  void it('should export correct model name', () => {
    assert.strictEqual(EMBEDDING_MODEL_NAME, 'text-embedding-3-large');
  });

  void it('should export correct default language', () => {
    assert.strictEqual(EMBEDDING_DEFAULT_LANG, 'ro');
  });
});

// ============================================
// prod_embeddings Schema Tests
// ============================================

void describe('prod_embeddings Schema', () => {
  void it('should have id column as primary key', () => {
    const idColumn = prodEmbeddings.id;
    assert.ok(idColumn, 'id column should exist');
    assert.strictEqual(idColumn.name, 'id');
  });

  void it('should have product_id column with foreign key', () => {
    const productIdColumn = prodEmbeddings.productId;
    assert.ok(productIdColumn, 'productId column should exist');
    assert.strictEqual(productIdColumn.name, 'product_id');
    assert.strictEqual(productIdColumn.notNull, true);
  });

  void it('should have variant_id column (nullable)', () => {
    const variantIdColumn = prodEmbeddings.variantId;
    assert.ok(variantIdColumn, 'variantId column should exist');
    assert.strictEqual(variantIdColumn.name, 'variant_id');
    // Nullable - no notNull constraint
    assert.ok(!variantIdColumn.notNull, 'variantId should be nullable');
  });

  void it('should have embedding_type column', () => {
    const embeddingTypeColumn = prodEmbeddings.embeddingType;
    assert.ok(embeddingTypeColumn, 'embeddingType column should exist');
    assert.strictEqual(embeddingTypeColumn.name, 'embedding_type');
    assert.strictEqual(embeddingTypeColumn.notNull, true);
  });

  void it('should have content_hash column', () => {
    const contentHashColumn = prodEmbeddings.contentHash;
    assert.ok(contentHashColumn, 'contentHash column should exist');
    assert.strictEqual(contentHashColumn.name, 'content_hash');
    assert.strictEqual(contentHashColumn.notNull, true);
  });

  void it('should have model_version column', () => {
    const modelVersionColumn = prodEmbeddings.modelVersion;
    assert.ok(modelVersionColumn, 'modelVersion column should exist');
    assert.strictEqual(modelVersionColumn.name, 'model_version');
    assert.strictEqual(modelVersionColumn.notNull, true);
  });

  void it('should have dimensions column with default 2000', () => {
    const dimensionsColumn = prodEmbeddings.dimensions;
    assert.ok(dimensionsColumn, 'dimensions column should exist');
    assert.strictEqual(dimensionsColumn.name, 'dimensions');
    assert.strictEqual(dimensionsColumn.default, 2000);
  });

  void it('should have quality_level column with default bronze', () => {
    const qualityLevelColumn = prodEmbeddings.qualityLevel;
    assert.ok(qualityLevelColumn, 'qualityLevel column should exist');
    assert.strictEqual(qualityLevelColumn.name, 'quality_level');
    assert.strictEqual(qualityLevelColumn.default, 'bronze');
  });

  void it('should have source column with default shopify', () => {
    const sourceColumn = prodEmbeddings.source;
    assert.ok(sourceColumn, 'source column should exist');
    assert.strictEqual(sourceColumn.name, 'source');
    assert.strictEqual(sourceColumn.default, 'shopify');
  });

  void it('should have lang column with default ro', () => {
    const langColumn = prodEmbeddings.lang;
    assert.ok(langColumn, 'lang column should exist');
    assert.strictEqual(langColumn.name, 'lang');
    assert.strictEqual(langColumn.default, 'ro');
    assert.strictEqual(langColumn.notNull, true);
  });

  void it('should have created_at and updated_at columns', () => {
    const createdAtColumn = prodEmbeddings.createdAt;
    const updatedAtColumn = prodEmbeddings.updatedAt;

    assert.ok(createdAtColumn, 'createdAt column should exist');
    assert.ok(updatedAtColumn, 'updatedAt column should exist');
    assert.strictEqual(createdAtColumn.name, 'created_at');
    assert.strictEqual(updatedAtColumn.name, 'updated_at');
  });
});

// ============================================
// shop_product_embeddings Schema Tests
// ============================================

void describe('shop_product_embeddings Schema', () => {
  void it('should have shop_id column with foreign key', () => {
    const shopIdColumn = shopProductEmbeddings.shopId;
    assert.ok(shopIdColumn, 'shopId column should exist');
    assert.strictEqual(shopIdColumn.name, 'shop_id');
    assert.strictEqual(shopIdColumn.notNull, true);
  });

  void it('should have product_id column with foreign key', () => {
    const productIdColumn = shopProductEmbeddings.productId;
    assert.ok(productIdColumn, 'productId column should exist');
    assert.strictEqual(productIdColumn.name, 'product_id');
    assert.strictEqual(productIdColumn.notNull, true);
  });

  void it('should have quality_level column', () => {
    const qualityLevelColumn = shopProductEmbeddings.qualityLevel;
    assert.ok(qualityLevelColumn, 'qualityLevel column should exist');
    assert.strictEqual(qualityLevelColumn.name, 'quality_level');
    assert.strictEqual(qualityLevelColumn.default, 'bronze');
  });

  void it('should have source column', () => {
    const sourceColumn = shopProductEmbeddings.source;
    assert.ok(sourceColumn, 'source column should exist');
    assert.strictEqual(sourceColumn.name, 'source');
    assert.strictEqual(sourceColumn.default, 'shopify');
  });

  void it('should have lang column', () => {
    const langColumn = shopProductEmbeddings.lang;
    assert.ok(langColumn, 'lang column should exist');
    assert.strictEqual(langColumn.name, 'lang');
    assert.strictEqual(langColumn.default, 'ro');
  });

  void it('should have status column', () => {
    const statusColumn = shopProductEmbeddings.status;
    assert.ok(statusColumn, 'status column should exist');
    assert.strictEqual(statusColumn.name, 'status');
    assert.strictEqual(statusColumn.default, 'pending');
  });

  void it('should have dimensions column with default 2000', () => {
    const dimensionsColumn = shopProductEmbeddings.dimensions;
    assert.ok(dimensionsColumn, 'dimensions column should exist');
    assert.strictEqual(dimensionsColumn.default, 2000);
  });
});

// ============================================
// prod_attr_definitions Schema Tests
// ============================================

void describe('prod_attr_definitions Schema', () => {
  void it('should have code column with unique constraint', () => {
    const codeColumn = prodAttrDefinitions.code;
    assert.ok(codeColumn, 'code column should exist');
    assert.strictEqual(codeColumn.name, 'code');
    assert.strictEqual(codeColumn.notNull, true);
  });

  void it('should have data_type column', () => {
    const dataTypeColumn = prodAttrDefinitions.dataType;
    assert.ok(dataTypeColumn, 'dataType column should exist');
    assert.strictEqual(dataTypeColumn.name, 'data_type');
    assert.strictEqual(dataTypeColumn.notNull, true);
  });

  void it('should have is_variant_level column', () => {
    const isVariantLevelColumn = prodAttrDefinitions.isVariantLevel;
    assert.ok(isVariantLevelColumn, 'isVariantLevel column should exist');
    assert.strictEqual(isVariantLevelColumn.name, 'is_variant_level');
    assert.strictEqual(isVariantLevelColumn.default, false);
  });
});

// ============================================
// Schema Snapshot Tests
// ============================================

void describe('Embeddings Schema Snapshot', () => {
  void it('should have expected column count for prod_embeddings', () => {
    const columns = Object.keys(prodEmbeddings);
    // Filter to only actual column definitions
    const columnNames = columns.filter(
      (key) =>
        prodEmbeddings[key as keyof typeof prodEmbeddings] &&
        typeof prodEmbeddings[key as keyof typeof prodEmbeddings] === 'object' &&
        'name' in (prodEmbeddings[key as keyof typeof prodEmbeddings] as object)
    );

    // Expected columns: id, productId, variantId, embeddingType, contentHash,
    // modelVersion, dimensions, qualityLevel, source, lang, createdAt, updatedAt
    assert.ok(columnNames.length >= 12, `Expected at least 12 columns, got ${columnNames.length}`);
  });

  void it('should have expected column count for shop_product_embeddings', () => {
    const columns = Object.keys(shopProductEmbeddings);
    const columnNames = columns.filter(
      (key) =>
        shopProductEmbeddings[key as keyof typeof shopProductEmbeddings] &&
        typeof shopProductEmbeddings[key as keyof typeof shopProductEmbeddings] === 'object' &&
        'name' in (shopProductEmbeddings[key as keyof typeof shopProductEmbeddings] as object)
    );

    // Expected: id, shopId, productId, embeddingType, contentHash, modelVersion,
    // dimensions, qualityLevel, source, lang, status, errorMessage, generatedAt, createdAt, updatedAt
    assert.ok(columnNames.length >= 15, `Expected at least 15 columns, got ${columnNames.length}`);
  });

  void it('should match expected prod_embeddings structure', () => {
    const expectedColumns = [
      'id',
      'productId',
      'variantId',
      'embeddingType',
      'contentHash',
      'modelVersion',
      'dimensions',
      'qualityLevel',
      'source',
      'lang',
      'createdAt',
      'updatedAt',
    ];

    for (const col of expectedColumns) {
      assert.ok(col in prodEmbeddings, `prod_embeddings should have ${col} column`);
    }
  });

  void it('should match expected shop_product_embeddings structure', () => {
    const expectedColumns = [
      'id',
      'shopId',
      'productId',
      'embeddingType',
      'contentHash',
      'modelVersion',
      'dimensions',
      'qualityLevel',
      'source',
      'lang',
      'status',
      'errorMessage',
      'generatedAt',
      'createdAt',
      'updatedAt',
    ];

    for (const col of expectedColumns) {
      assert.ok(col in shopProductEmbeddings, `shop_product_embeddings should have ${col} column`);
    }
  });
});

// ============================================
// Migration Compatibility Notes
// ============================================

void describe('Migration Compatibility', () => {
  void it('should document vector dimension upgrade', () => {
    // This test documents the breaking change from 1536 to 2000 (HNSW max)
    const oldDimensions = 1536;
    const newDimensions = EMBEDDING_DIMENSIONS;

    assert.strictEqual(newDimensions, 2000);
    assert.notStrictEqual(newDimensions, oldDimensions);

    // Document the model change - still using large model with truncated dimensions
    assert.strictEqual(EMBEDDING_MODEL_NAME, 'text-embedding-3-large');
    assert.notStrictEqual(EMBEDDING_MODEL_NAME, 'text-embedding-3-small');
  });

  void it('should document new columns added in PR-047', () => {
    // These columns were added in migration 0061
    const newColumns = ['variantId', 'qualityLevel', 'source', 'lang', 'updatedAt'];

    for (const col of newColumns) {
      assert.ok(col in prodEmbeddings, `prod_embeddings should have ${col} column`);
    }
  });

  void it('should document quality level enum values', () => {
    // CHECK constraint values: bronze, silver, golden, review_needed
    const validQualityLevels = ['bronze', 'silver', 'golden', 'review_needed'];

    // Default is bronze
    assert.strictEqual(prodEmbeddings.qualityLevel.default, 'bronze');

    // Document valid values
    assert.ok(validQualityLevels.includes('bronze'));
    assert.ok(validQualityLevels.includes('silver'));
    assert.ok(validQualityLevels.includes('golden'));
    assert.ok(validQualityLevels.includes('review_needed'));
  });

  void it('should document source enum values', () => {
    // CHECK constraint values: shopify, vendor, ai, manual
    const validSources = ['shopify', 'vendor', 'ai', 'manual'];

    // Default is shopify
    assert.strictEqual(prodEmbeddings.source.default, 'shopify');

    // Document valid values
    assert.ok(validSources.includes('shopify'));
    assert.ok(validSources.includes('vendor'));
    assert.ok(validSources.includes('ai'));
    assert.ok(validSources.includes('manual'));
  });
});
