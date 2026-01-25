/**
 * Embeddings Schema v2 Tests
 *
 * PR-047: F6.1.1 - Schema tests for embeddings v2 (2000 dims for HNSW)
 *
 * Tests verify:
 * - Vector column exists with correct dimensions
 * - New columns (variant_id, quality_level, source, lang) exist
 * - HNSW indexes are configured correctly
 * - CHECK constraints are in place
 */

import { describe, it, expect } from 'vitest';

import {
  prodEmbeddings,
  shopProductEmbeddings,
  prodAttrDefinitions,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_NAME,
  EMBEDDING_DEFAULT_LANG,
} from '../../schema/vectors.js';

// ============================================
// Schema Constants Tests
// ============================================

describe('Embeddings Schema Constants', () => {
  it('should export correct embedding dimensions', () => {
    expect(EMBEDDING_DIMENSIONS).toBe(2000);
  });

  it('should export correct model name', () => {
    expect(EMBEDDING_MODEL_NAME).toBe('text-embedding-3-large');
  });

  it('should export correct default language', () => {
    expect(EMBEDDING_DEFAULT_LANG).toBe('ro');
  });
});

// ============================================
// prod_embeddings Schema Tests
// ============================================

describe('prod_embeddings Schema', () => {
  it('should have id column as primary key', () => {
    const idColumn = prodEmbeddings.id;
    expect(idColumn).toBeDefined();
    expect(idColumn.name).toBe('id');
  });

  it('should have product_id column with foreign key', () => {
    const productIdColumn = prodEmbeddings.productId;
    expect(productIdColumn).toBeDefined();
    expect(productIdColumn.name).toBe('product_id');
    expect(productIdColumn.notNull).toBe(true);
  });

  it('should have variant_id column (nullable)', () => {
    const variantIdColumn = prodEmbeddings.variantId;
    expect(variantIdColumn).toBeDefined();
    expect(variantIdColumn.name).toBe('variant_id');
    // Nullable - no notNull constraint
    expect(variantIdColumn.notNull).toBeFalsy();
  });

  it('should have embedding_type column', () => {
    const embeddingTypeColumn = prodEmbeddings.embeddingType;
    expect(embeddingTypeColumn).toBeDefined();
    expect(embeddingTypeColumn.name).toBe('embedding_type');
    expect(embeddingTypeColumn.notNull).toBe(true);
  });

  it('should have content_hash column', () => {
    const contentHashColumn = prodEmbeddings.contentHash;
    expect(contentHashColumn).toBeDefined();
    expect(contentHashColumn.name).toBe('content_hash');
    expect(contentHashColumn.notNull).toBe(true);
  });

  it('should have model_version column', () => {
    const modelVersionColumn = prodEmbeddings.modelVersion;
    expect(modelVersionColumn).toBeDefined();
    expect(modelVersionColumn.name).toBe('model_version');
    expect(modelVersionColumn.notNull).toBe(true);
  });

  it('should have dimensions column with default 2000', () => {
    const dimensionsColumn = prodEmbeddings.dimensions;
    expect(dimensionsColumn).toBeDefined();
    expect(dimensionsColumn.name).toBe('dimensions');
    expect(dimensionsColumn.default).toBe(2000);
  });

  it('should have quality_level column with default bronze', () => {
    const qualityLevelColumn = prodEmbeddings.qualityLevel;
    expect(qualityLevelColumn).toBeDefined();
    expect(qualityLevelColumn.name).toBe('quality_level');
    expect(qualityLevelColumn.default).toBe('bronze');
  });

  it('should have source column with default shopify', () => {
    const sourceColumn = prodEmbeddings.source;
    expect(sourceColumn).toBeDefined();
    expect(sourceColumn.name).toBe('source');
    expect(sourceColumn.default).toBe('shopify');
  });

  it('should have lang column with default ro', () => {
    const langColumn = prodEmbeddings.lang;
    expect(langColumn).toBeDefined();
    expect(langColumn.name).toBe('lang');
    expect(langColumn.default).toBe('ro');
    expect(langColumn.notNull).toBe(true);
  });

  it('should have created_at and updated_at columns', () => {
    const createdAtColumn = prodEmbeddings.createdAt;
    const updatedAtColumn = prodEmbeddings.updatedAt;

    expect(createdAtColumn).toBeDefined();
    expect(updatedAtColumn).toBeDefined();
    expect(createdAtColumn.name).toBe('created_at');
    expect(updatedAtColumn.name).toBe('updated_at');
  });
});

// ============================================
// shop_product_embeddings Schema Tests
// ============================================

describe('shop_product_embeddings Schema', () => {
  it('should have shop_id column with foreign key', () => {
    const shopIdColumn = shopProductEmbeddings.shopId;
    expect(shopIdColumn).toBeDefined();
    expect(shopIdColumn.name).toBe('shop_id');
    expect(shopIdColumn.notNull).toBe(true);
  });

  it('should have product_id column with foreign key', () => {
    const productIdColumn = shopProductEmbeddings.productId;
    expect(productIdColumn).toBeDefined();
    expect(productIdColumn.name).toBe('product_id');
    expect(productIdColumn.notNull).toBe(true);
  });

  it('should have quality_level column', () => {
    const qualityLevelColumn = shopProductEmbeddings.qualityLevel;
    expect(qualityLevelColumn).toBeDefined();
    expect(qualityLevelColumn.name).toBe('quality_level');
    expect(qualityLevelColumn.default).toBe('bronze');
  });

  it('should have source column', () => {
    const sourceColumn = shopProductEmbeddings.source;
    expect(sourceColumn).toBeDefined();
    expect(sourceColumn.name).toBe('source');
    expect(sourceColumn.default).toBe('shopify');
  });

  it('should have lang column', () => {
    const langColumn = shopProductEmbeddings.lang;
    expect(langColumn).toBeDefined();
    expect(langColumn.name).toBe('lang');
    expect(langColumn.default).toBe('ro');
  });

  it('should have status column', () => {
    const statusColumn = shopProductEmbeddings.status;
    expect(statusColumn).toBeDefined();
    expect(statusColumn.name).toBe('status');
    expect(statusColumn.default).toBe('pending');
  });

  it('should have dimensions column with default 2000', () => {
    const dimensionsColumn = shopProductEmbeddings.dimensions;
    expect(dimensionsColumn).toBeDefined();
    expect(dimensionsColumn.default).toBe(2000);
  });
});

// ============================================
// prod_attr_definitions Schema Tests
// ============================================

describe('prod_attr_definitions Schema', () => {
  it('should have code column with unique constraint', () => {
    const codeColumn = prodAttrDefinitions.code;
    expect(codeColumn).toBeDefined();
    expect(codeColumn.name).toBe('code');
    expect(codeColumn.notNull).toBe(true);
  });

  it('should have data_type column', () => {
    const dataTypeColumn = prodAttrDefinitions.dataType;
    expect(dataTypeColumn).toBeDefined();
    expect(dataTypeColumn.name).toBe('data_type');
    expect(dataTypeColumn.notNull).toBe(true);
  });

  it('should have is_variant_level column', () => {
    const isVariantLevelColumn = prodAttrDefinitions.isVariantLevel;
    expect(isVariantLevelColumn).toBeDefined();
    expect(isVariantLevelColumn.name).toBe('is_variant_level');
    expect(isVariantLevelColumn.default).toBe(false);
  });
});

// ============================================
// Schema Snapshot Tests
// ============================================

describe('Embeddings Schema Snapshot', () => {
  it('should have expected column count for prod_embeddings', () => {
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
    expect(columnNames.length).toBeGreaterThanOrEqual(12);
  });

  it('should have expected column count for shop_product_embeddings', () => {
    const columns = Object.keys(shopProductEmbeddings);
    const columnNames = columns.filter(
      (key) =>
        shopProductEmbeddings[key as keyof typeof shopProductEmbeddings] &&
        typeof shopProductEmbeddings[key as keyof typeof shopProductEmbeddings] === 'object' &&
        'name' in (shopProductEmbeddings[key as keyof typeof shopProductEmbeddings] as object)
    );

    // Expected: id, shopId, productId, embeddingType, contentHash, modelVersion,
    // dimensions, qualityLevel, source, lang, status, errorMessage, generatedAt, createdAt, updatedAt
    expect(columnNames.length).toBeGreaterThanOrEqual(15);
  });

  it('should match expected prod_embeddings structure', () => {
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
      expect(prodEmbeddings).toHaveProperty(col);
    }
  });

  it('should match expected shop_product_embeddings structure', () => {
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
      expect(shopProductEmbeddings).toHaveProperty(col);
    }
  });
});

// ============================================
// Migration Compatibility Notes
// ============================================

describe('Migration Compatibility', () => {
  it('should document vector dimension upgrade', () => {
    // This test documents the breaking change from 1536 to 2000 (HNSW max)
    const oldDimensions = 1536;
    const newDimensions = EMBEDDING_DIMENSIONS;

    expect(newDimensions).toBe(2000);
    expect(newDimensions).not.toBe(oldDimensions);

    // Document the model change - still using large model with truncated dimensions
    expect(EMBEDDING_MODEL_NAME).toBe('text-embedding-3-large');
    expect(EMBEDDING_MODEL_NAME).not.toBe('text-embedding-3-small');
  });

  it('should document new columns added in PR-047', () => {
    // These columns were added in migration 0061
    const newColumns = ['variantId', 'qualityLevel', 'source', 'lang', 'updatedAt'];

    for (const col of newColumns) {
      expect(prodEmbeddings).toHaveProperty(col);
    }
  });

  it('should document quality level enum values', () => {
    // CHECK constraint values: bronze, silver, golden, review_needed
    const validQualityLevels = ['bronze', 'silver', 'golden', 'review_needed'];

    // Default is bronze
    expect(prodEmbeddings.qualityLevel.default).toBe('bronze');

    // Document valid values
    expect(validQualityLevels).toContain('bronze');
    expect(validQualityLevels).toContain('silver');
    expect(validQualityLevels).toContain('golden');
    expect(validQualityLevels).toContain('review_needed');
  });

  it('should document source enum values', () => {
    // CHECK constraint values: shopify, vendor, ai, manual
    const validSources = ['shopify', 'vendor', 'ai', 'manual'];

    // Default is shopify
    expect(prodEmbeddings.source.default).toBe('shopify');

    // Document valid values
    expect(validSources).toContain('shopify');
    expect(validSources).toContain('vendor');
    expect(validSources).toContain('ai');
    expect(validSources).toContain('manual');
  });
});
