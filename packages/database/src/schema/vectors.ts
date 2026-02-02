/**
 * Module E: Attribute Normalization & Vectors
 *
 * CONFORM: Database_Schema_Complete.md v2.6 - Module E
 * PR-010: F2.2.7 - pgvector Embeddings Schema
 * PR-047: F6.1.1-F6.1.2 - Embeddings Schema v2 (2000 dims for HNSW)
 *
 * DECIZIE ARHITECTURALĂ (2025):
 * - pgvector (Postgres) este SINGURA soluție de vector storage
 * - Redis NU se folosește pentru vectori (doar cache/queues)
 * - HNSW indexes pentru performanță (<10ms latency)
 *
 * PR-047 UPGRADE:
 * - Migrated from vector(1536) to vector(2000) for text-embedding-3-large (HNSW limit)
 * - Added variant_id, quality_level, source, lang columns
 * - Added Romanian language support as default
 *
 * TABELE:
 * - prod_attr_definitions: Registry atribute canonice cu embeddings
 * - prod_attr_synonyms: Sinonime pentru normalizare
 * - prod_embeddings: Embeddings produse PIM global (NO RLS)
 * - shop_product_embeddings: Embeddings per-tenant pentru Shopify (RLS)
 */

import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  decimal,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { shops } from './shops.js';
import { shopifyProducts, shopifyVariants } from './shopify-products.js';
import { prodMaster } from './pim.js';

// ============================================
// Constants
// ============================================

/** Current embedding model */
export const EMBEDDING_MODEL_NAME = 'text-embedding-3-large';

/** Embedding vector dimensions (max 2000 for HNSW index) */
export const EMBEDDING_DIMENSIONS = 2000;

/** Default language for embeddings */
export const EMBEDDING_DEFAULT_LANG = 'ro';

// ============================================
// Custom pgvector type pentru Drizzle
// ============================================
// Drizzle nu are suport nativ pentru vector, folosim customType
// Dimensiunile (2000) sunt pentru OpenAI text-embedding-3-large (truncated for HNSW)
// NOTĂ: Indexurile HNSW se definesc în migrația SQL

// ============================================
// 1. prod_attr_definitions - Canonical Attribute Registry
// ============================================

export const prodAttrDefinitions = pgTable(
  'prod_attr_definitions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    code: varchar('code', { length: 100 }).notNull().unique(),
    label: varchar('label', { length: 255 }).notNull(),
    description: text('description'),

    dataType: varchar('data_type', { length: 30 }).notNull(), // string/number/boolean/enum
    unit: varchar('unit', { length: 50 }), // Default unit
    unitFamily: varchar('unit_family', { length: 50 }), // length/weight/volume

    allowedValues: jsonb('allowed_values'), // Enum values
    validationRegex: varchar('validation_regex', { length: 255 }), // Input validation

    isRequired: boolean('is_required').default(false),
    isVariantLevel: boolean('is_variant_level').default(false),
    isSearchable: boolean('is_searchable').default(true),
    isFilterable: boolean('is_filterable').default(true),
    displayOrder: integer('display_order').default(0),

    // Embedding pentru căutare semantică - operat ca text (vector definit în SQL)
    // embedding: vector(2000) - definit în migrație cu HNSW index (PR-047: upgraded from 1536)

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_attr_code').on(table.code),
    index('idx_attr_type').on(table.dataType),
  ]
);

export type ProdAttrDefinition = typeof prodAttrDefinitions.$inferSelect;
export type NewProdAttrDefinition = typeof prodAttrDefinitions.$inferInsert;

// ============================================
// 2. prod_attr_synonyms - Synonym Mapping
// ============================================

export const prodAttrSynonyms = pgTable(
  'prod_attr_synonyms',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    definitionId: uuid('definition_id')
      .notNull()
      .references(() => prodAttrDefinitions.id),

    synonymText: varchar('synonym_text', { length: 255 }).notNull(),
    locale: varchar('locale', { length: 10 }).default('ro'),

    source: varchar('source', { length: 50 }), // manual/ai/import
    confidenceScore: decimal('confidence_score', { precision: 3, scale: 2 }).default('1.0'),

    isApproved: boolean('is_approved').default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_synonyms_definition').on(table.definitionId),
    index('idx_synonyms_text').on(table.synonymText),
    // Trigram index definit în SQL: idx_synonyms_text_trgm
  ]
);

export type ProdAttrSynonym = typeof prodAttrSynonyms.$inferSelect;
export type NewProdAttrSynonym = typeof prodAttrSynonyms.$inferInsert;

// ============================================
// 3. prod_embeddings - Global PIM Product Embeddings
// ============================================
// NO RLS - Global PIM data
// PR-047: Added variant_id, quality_level, source, lang columns

export const prodEmbeddings = pgTable(
  'prod_embeddings',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    productId: uuid('product_id')
      .notNull()
      .references(() => prodMaster.id),

    // PR-047: Added variant_id for variant-specific embeddings
    variantId: uuid('variant_id').references(() => shopifyVariants.id, { onDelete: 'set null' }),

    embeddingType: varchar('embedding_type', { length: 50 }).notNull(), // title/description/specs/combined

    // embedding: vector(2000) - definit în SQL cu HNSW index (PR-047: upgraded from 1536)

    contentHash: varchar('content_hash', { length: 64 }).notNull(), // Source content hash (SHA-256)
    modelVersion: varchar('model_version', { length: 50 }).notNull(), // text-embedding-3-large
    dimensions: integer('dimensions').default(2000), // PR-047: upgraded from 1536

    // PR-047: New columns for quality-based embeddings
    qualityLevel: varchar('quality_level', { length: 20 }).default('bronze'), // bronze/silver/golden/review_needed
    source: varchar('source', { length: 50 }).default('shopify'), // shopify/vendor/ai/manual
    lang: varchar('lang', { length: 10 }).notNull().default('ro'), // Default Romanian

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_embeddings_product').on(table.productId),
    index('idx_embeddings_type').on(table.productId, table.embeddingType),
    // PR-047: New indexes
    index('idx_embeddings_product_variant').on(table.productId, table.variantId),
    index('idx_embeddings_quality_updated').on(table.qualityLevel, table.updatedAt),
    index('idx_embeddings_lang').on(table.lang),
    index('idx_embeddings_source').on(table.source),
    // HNSW vector index definit în SQL: idx_embeddings_vector
    // Unique constraint: (product_id, variant_id, quality_level, embedding_type)
  ]
);

export type ProdEmbedding = typeof prodEmbeddings.$inferSelect;
export type NewProdEmbedding = typeof prodEmbeddings.$inferInsert;

// ============================================
// 4. shop_product_embeddings - Per-Tenant Embeddings
// ============================================
// HAS RLS - Multi-tenant data
// PR-047: Added quality_level, source, lang columns

export const shopProductEmbeddings = pgTable(
  'shop_product_embeddings',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),

    productId: uuid('product_id')
      .notNull()
      .references(() => shopifyProducts.id),

    embeddingType: varchar('embedding_type', { length: 50 }).notNull(), // title/description/combined

    // embedding: vector(2000) - definit în SQL cu HNSW index (PR-047: upgraded from 1536)

    contentHash: varchar('content_hash', { length: 64 }).notNull(), // For change detection
    modelVersion: varchar('model_version', { length: 50 }).notNull(), // text-embedding-3-large
    dimensions: integer('dimensions').default(2000), // PR-047: upgraded from 1536

    // PR-047: New columns
    qualityLevel: varchar('quality_level', { length: 20 }).default('bronze'), // bronze/silver/golden/review_needed
    source: varchar('source', { length: 50 }).default('shopify'), // shopify/vendor/ai/manual
    lang: varchar('lang', { length: 10 }).notNull().default('ro'), // Default Romanian

    status: varchar('status', { length: 20 }).default('pending'), // pending/ready/failed
    errorMessage: text('error_message'),
    retryCount: integer('retry_count').default(0),

    generatedAt: timestamp('generated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_shop_embeddings_product').on(
      table.shopId,
      table.productId,
      table.contentHash,
      table.embeddingType,
      table.modelVersion
    ),
    index('idx_shop_embeddings_hash').on(table.shopId, table.contentHash),
    index('idx_shop_embeddings_pending').on(table.shopId, table.status),
    // PR-047: New indexes
    index('idx_shop_embeddings_quality').on(table.shopId, table.qualityLevel),
    index('idx_shop_embeddings_lang').on(table.shopId, table.lang),
    // HNSW vector index definit în SQL: idx_shop_embeddings_vector
    // RLS policy definită în SQL
  ]
);

export type ShopProductEmbedding = typeof shopProductEmbeddings.$inferSelect;
export type NewShopProductEmbedding = typeof shopProductEmbeddings.$inferInsert;
