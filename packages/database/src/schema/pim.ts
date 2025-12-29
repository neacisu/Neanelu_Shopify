/**
 * Module D: Global PIM (Product Information Management)
 *
 * CONFORM: Database_Schema_Complete.md v2.6 - Module D
 * PR-010: F2.2.5 - PIM Core Schema (4-Layer Architecture)
 *
 * ARHITECTURĂ:
 * 1. Governance Layer: prod_taxonomy
 * 2. Raw Ingestion Layer: prod_sources, prod_raw_harvest
 * 3. Process Layer: prod_extraction_sessions
 * 4. Golden Record Layer: prod_master, prod_specs_normalized, prod_semantics
 * 5. Channel Mapping: prod_channel_mappings (link PIM → Shopify)
 *
 * NOTĂ CRITICĂ: Aceste tabele NU au RLS - sunt date globale PIM.
 * Access control se face la nivel de aplicație.
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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { shops } from './shops.js';

// ============================================
// 1. GOVERNANCE LAYER: prod_taxonomy
// ============================================

export const prodTaxonomy = pgTable(
  'prod_taxonomy',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    parentId: uuid('parent_id').references((): AnyPgColumn => prodTaxonomy.id),

    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull().unique(),

    // Path în arbore
    breadcrumbs: text('breadcrumbs').array(),
    level: integer('level').notNull().default(0),

    // Schema de atribute obligatorii pentru categoria
    attributeSchema: jsonb('attribute_schema').default({}),
    validationRules: jsonb('validation_rules').default({}),

    // Mapping-uri externe
    externalMappings: jsonb('external_mappings').default({}), // {shopify, google, facebook}
    shopifyTaxonomyId: varchar('shopify_taxonomy_id', { length: 100 }),

    isActive: boolean('is_active').default(true),
    sortOrder: integer('sort_order').default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_taxonomy_parent').on(table.parentId),
    uniqueIndex('idx_taxonomy_slug').on(table.slug),
    index('idx_taxonomy_shopify').on(table.shopifyTaxonomyId),
  ]
);

export type ProdTaxonomy = typeof prodTaxonomy.$inferSelect;
export type NewProdTaxonomy = typeof prodTaxonomy.$inferInsert;

// ============================================
// 2. RAW INGESTION LAYER: prod_sources
// ============================================

export const prodSources = pgTable(
  'prod_sources',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    name: varchar('name', { length: 100 }).notNull().unique(),
    sourceType: varchar('source_type', { length: 50 }).notNull(), // SUPPLIER/MANUFACTURER/SCRAPER

    baseUrl: text('base_url'),
    priority: integer('priority').default(50), // Conflict resolution
    trustScore: decimal('trust_score', { precision: 3, scale: 2 }).default('0.5'), // 0.0-1.0

    config: jsonb('config').default({}), // Scraper config
    rateLimit: jsonb('rate_limit'), // {requests_per_second}
    authConfig: jsonb('auth_config'), // Encrypted credentials ref

    isActive: boolean('is_active').default(true),
    lastHarvestAt: timestamp('last_harvest_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_sources_name').on(table.name),
    index('idx_sources_type').on(table.sourceType),
  ]
);

export type ProdSource = typeof prodSources.$inferSelect;
export type NewProdSource = typeof prodSources.$inferInsert;

// ============================================
// 2. RAW INGESTION LAYER: prod_raw_harvest
// ============================================

export const prodRawHarvest = pgTable(
  'prod_raw_harvest',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    sourceId: uuid('source_id')
      .notNull()
      .references(() => prodSources.id),

    targetSku: varchar('target_sku', { length: 100 }), // Matched SKU if known
    sourceUrl: text('source_url').notNull(),
    sourceProductId: varchar('source_product_id', { length: 255 }), // External product ID

    rawHtml: text('raw_html'),
    rawJson: jsonb('raw_json'),

    httpStatus: integer('http_status'),
    responseHeaders: jsonb('response_headers'),

    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow(),

    processingStatus: varchar('processing_status', { length: 20 }).default('pending'), // pending/processed/failed
    processingError: text('processing_error'),
    processedAt: timestamp('processed_at', { withTimezone: true }),

    contentHash: varchar('content_hash', { length: 64 }), // SHA256 for dedup
    ttlExpiresAt: timestamp('ttl_expires_at', { withTimezone: true }), // Cache expiration

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_harvest_source').on(table.sourceId),
    index('idx_harvest_status').on(table.processingStatus),
    index('idx_harvest_sku').on(table.targetSku),
    index('idx_harvest_url').on(table.sourceUrl),
    index('idx_harvest_hash').on(table.contentHash),
  ]
);

export type ProdRawHarvest = typeof prodRawHarvest.$inferSelect;
export type NewProdRawHarvest = typeof prodRawHarvest.$inferInsert;

// ============================================
// 3. PROCESS LAYER: prod_extraction_sessions
// ============================================

export const prodExtractionSessions = pgTable(
  'prod_extraction_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    harvestId: uuid('harvest_id')
      .notNull()
      .references(() => prodRawHarvest.id),

    agentVersion: varchar('agent_version', { length: 50 }).notNull(),
    modelName: varchar('model_name', { length: 100 }), // gpt-4o/gemini-pro

    extractedSpecs: jsonb('extracted_specs').notNull(), // {key: value} pairs
    groundingSnippets: jsonb('grounding_snippets'), // Source text evidence

    confidenceScore: decimal('confidence_score', { precision: 3, scale: 2 }), // 0.0-1.0 overall
    fieldConfidences: jsonb('field_confidences'), // Per-field scores

    tokensUsed: integer('tokens_used'), // API tokens consumed
    latencyMs: integer('latency_ms'), // Processing time

    errorMessage: text('error_message'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_extraction_harvest').on(table.harvestId),
    index('idx_extraction_confidence').on(table.confidenceScore),
  ]
);

export type ProdExtractionSession = typeof prodExtractionSessions.$inferSelect;
export type NewProdExtractionSession = typeof prodExtractionSessions.$inferInsert;

// ============================================
// 4. GOLDEN RECORD LAYER: prod_master
// ============================================

export const prodMaster = pgTable(
  'prod_master',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    internalSku: varchar('internal_sku', { length: 100 }).notNull().unique(),
    canonicalTitle: text('canonical_title').notNull(),

    brand: varchar('brand', { length: 255 }),
    manufacturer: varchar('manufacturer', { length: 255 }),
    mpn: varchar('mpn', { length: 100 }), // Manufacturer part #
    gtin: varchar('gtin', { length: 14 }), // Global Trade Item #

    taxonomyId: uuid('taxonomy_id').references(() => prodTaxonomy.id),

    // Deduplication status
    dedupeStatus: varchar('dedupe_status', { length: 20 }).default('unique'), // unique/merged/duplicate
    dedupeClusterId: uuid('dedupe_cluster_id'),

    primarySourceId: uuid('primary_source_id').references(() => prodSources.id),

    // Lifecycle management
    lifecycleStatus: varchar('lifecycle_status', { length: 20 }).default('active'), // active/discontinued/draft

    // Quality tracking (Bronze/Silver/Golden progression)
    dataQualityLevel: varchar('data_quality_level', { length: 20 }).notNull().default('bronze'), // bronze/silver/golden/review_needed
    qualityScore: decimal('quality_score', { precision: 3, scale: 2 }), // 0.0-1.0
    qualityScoreBreakdown: jsonb('quality_score_breakdown').default({}), // {completeness, accuracy, consistency}
    lastQualityCheck: timestamp('last_quality_check', { withTimezone: true }),
    promotedToSilverAt: timestamp('promoted_to_silver_at', { withTimezone: true }),
    promotedToGoldenAt: timestamp('promoted_to_golden_at', { withTimezone: true }),

    needsReview: boolean('needs_review').default(false),
    reviewNotes: text('review_notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_master_sku').on(table.internalSku),
    index('idx_master_brand').on(table.brand),
    index('idx_master_taxonomy').on(table.taxonomyId),
    index('idx_master_gtin').on(table.gtin),
    index('idx_master_mpn').on(table.manufacturer, table.mpn),
    index('idx_master_review').on(table.needsReview),
    index('idx_master_quality_level').on(table.dataQualityLevel),
  ]
);

export type ProdMaster = typeof prodMaster.$inferSelect;
export type NewProdMaster = typeof prodMaster.$inferInsert;

// ============================================
// 4. GOLDEN RECORD LAYER: prod_specs_normalized
// ============================================

export const prodSpecsNormalized = pgTable(
  'prod_specs_normalized',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    productId: uuid('product_id')
      .notNull()
      .references(() => prodMaster.id),

    specs: jsonb('specs').notNull(), // {attr_code: {value, unit}}
    rawSpecs: jsonb('raw_specs'), // Original before normalization

    provenance: jsonb('provenance').notNull(), // {source_id, extraction_id, timestamp}

    version: integer('version').notNull().default(1),
    isCurrent: boolean('is_current').default(true),

    needsReview: boolean('needs_review').default(false),
    reviewReason: varchar('review_reason', { length: 100 }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_specs_product').on(table.productId),
    index('idx_specs_current').on(table.productId),
    index('idx_specs_review').on(table.needsReview),
  ]
);

export type ProdSpecsNormalized = typeof prodSpecsNormalized.$inferSelect;
export type NewProdSpecsNormalized = typeof prodSpecsNormalized.$inferInsert;

// ============================================
// 4. GOLDEN RECORD LAYER: prod_semantics
// ============================================

export const prodSemantics = pgTable(
  'prod_semantics',
  {
    productId: uuid('product_id')
      .primaryKey()
      .references(() => prodMaster.id),

    titleMaster: text('title_master').notNull(), // SEO-optimized title
    descriptionMaster: text('description_master'), // Long description
    descriptionShort: varchar('description_short', { length: 500 }), // Summary

    aiSummary: text('ai_summary'), // AI-generated summary

    keywords: text('keywords').array(), // Search keywords
    keywordsGraph: jsonb('keywords_graph'), // Related terms graph

    jsonLdSchema: jsonb('json_ld_schema'), // Schema.org Product

    // Full-text search vector - computed column via trigger
    // searchVector: tsvector - defined in SQL migration

    locale: varchar('locale', { length: 10 }).default('ro'),

    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [index('idx_semantics_locale').on(table.locale)]
);

export type ProdSemantics = typeof prodSemantics.$inferSelect;
export type NewProdSemantics = typeof prodSemantics.$inferInsert;

// ============================================
// 5. CHANNEL MAPPING: prod_channel_mappings
// ============================================

export const prodChannelMappings = pgTable(
  'prod_channel_mappings',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    productId: uuid('product_id')
      .notNull()
      .references(() => prodMaster.id),

    channel: varchar('channel', { length: 50 }).notNull(), // shopify/google/facebook

    shopId: uuid('shop_id').references(() => shops.id), // For Shopify channel
    externalId: varchar('external_id', { length: 255 }).notNull(), // Channel product ID

    syncStatus: varchar('sync_status', { length: 20 }).default('pending'), // pending/synced/error

    lastPushedAt: timestamp('last_pushed_at', { withTimezone: true }),
    lastPulledAt: timestamp('last_pulled_at', { withTimezone: true }),

    channelMeta: jsonb('channel_meta').default({}), // Channel-specific data
    errorMessage: text('error_message'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_channel_product').on(table.productId),
    uniqueIndex('idx_channel_external').on(table.channel, table.shopId, table.externalId),
    index('idx_channel_status').on(table.channel, table.syncStatus),
  ]
);

export type ProdChannelMapping = typeof prodChannelMappings.$inferSelect;
export type NewProdChannelMapping = typeof prodChannelMappings.$inferInsert;
