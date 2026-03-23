/**
 * Module N: Lexical Intelligence & Contextual Translation
 *
 * This module is additive over the existing Shopify mirror + PIM layers.
 * Operational shop-scoped tables are intended to be RLS-protected via SQL migrations.
 * Canonical/global tables intentionally support a hybrid global + shop override model.
 */

import {
  type AnyPgColumn,
  pgTable,
  pgView,
  uuid,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  decimal,
  bigint,
  smallint,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { aiBatchItems } from './ai-batches.ts';
import { shops } from './shops.ts';
import { staffUsers } from './staff-users.ts';
import { prodMaster, prodTaxonomy } from './pim.ts';
import { prodAttrDefinitions } from './vectors.ts';
import { shopifyProducts, shopifyVariants } from './shopify-products.ts';
import { shopifyCollections } from './shopify-collections.ts';

export const lexShopSettings = pgTable(
  'lex_shop_settings',
  {
    shopId: uuid('shop_id')
      .primaryKey()
      .references(() => shops.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    enabled: boolean('enabled').notNull().default(false),
    sourceLang: varchar('source_lang', { length: 10 }).notNull().default('ro'),
    targetLangs: text('target_langs')
      .array()
      .notNull()
      .default(sql`'{en}'::text[]`),
    extractScope: jsonb('extract_scope').notNull().default({}),
    shardSize: integer('shard_size').notNull().default(10_000),
    thresholds: jsonb('thresholds').notNull().default({}),
    retentionDaysFragments: integer('retention_days_fragments').notNull().default(90),
    retentionDaysOccurrences: integer('retention_days_occurrences').notNull().default(90),
    retentionDaysContexts: integer('retention_days_contexts').notNull().default(180),
    autoPublishProducts: boolean('auto_publish_products').notNull().default(false),
    autoPublishAttributes: boolean('auto_publish_attributes').notNull().default(false),
    autoPublishCollections: boolean('auto_publish_collections').notNull().default(false),
    /** single | consensus | auto */
    translationMode: varchar('translation_mode', { length: 20 }).notNull().default('auto'),
    consensusEscalationThreshold: decimal('consensus_escalation_threshold', {
      precision: 5,
      scale: 4,
    })
      .notNull()
      .default('0.8000'),
    translationAutoApproveThreshold: decimal('translation_auto_approve_threshold', {
      precision: 5,
      scale: 4,
    })
      .notNull()
      .default('0.9300'),
    localizationAutoApproveThreshold: decimal('localization_auto_approve_threshold', {
      precision: 5,
      scale: 4,
    })
      .notNull()
      .default('0.8500'),
    tmEnabled: boolean('tm_enabled').notNull().default(true),
    tmSimilarityThreshold: decimal('tm_similarity_threshold', { precision: 5, scale: 4 })
      .notNull()
      .default('0.9200'),
    qualityAuditEnabled: boolean('quality_audit_enabled').notNull().default(true),
    qualityAuditMinBatchSize: integer('quality_audit_min_batch_size').notNull().default(50),
    maxTermsPerLlmBatch: integer('max_terms_per_llm_batch').notNull().default(10),
    guardrailsLexMode: varchar('guardrails_lex_mode', { length: 20 }).notNull().default('warn'),
    guardrailsWarnThreshold: integer('guardrails_warn_threshold').notNull().default(1000),
    guardrailsWarnCount: integer('guardrails_warn_count').notNull().default(0),
    guardrailsBlockCount: integer('guardrails_block_count').notNull().default(0),
    guardrailsFalsePositiveCount: integer('guardrails_false_positive_count').notNull().default(0),
    guardrailsLastEvaluatedAt: timestamp('guardrails_last_evaluated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [index('idx_lex_shop_settings_enabled').on(table.enabled)]
);

export const lexRuns = pgTable(
  'lex_runs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    runType: varchar('run_type', { length: 30 }).notNull(),
    sourceScope: jsonb('source_scope').notNull().default({}),
    sourceSnapshotHash: varchar('source_snapshot_hash', { length: 64 }),
    currentPhase: varchar('current_phase', { length: 50 }).notNull().default('extract.fragments'),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    phaseStartedAt: timestamp('phase_started_at', { withTimezone: true }),
    phaseCompletedAt: timestamp('phase_completed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    resumedAt: timestamp('resumed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    pauseReason: varchar('pause_reason', { length: 50 }),
    completedWithErrors: boolean('completed_with_errors').notNull().default(false),
    fragmentsCount: bigint('fragments_count', { mode: 'number' }).default(0),
    occurrencesCount: bigint('occurrences_count', { mode: 'number' }).default(0),
    termsCount: bigint('terms_count', { mode: 'number' }).default(0),
    contextsCount: bigint('contexts_count', { mode: 'number' }).default(0),
    senseClustersCount: bigint('sense_clusters_count', { mode: 'number' }).default(0),
    translationsCount: bigint('translations_count', { mode: 'number' }).default(0),
    aiBatchesCount: integer('ai_batches_count').default(0),
    errorMessage: text('error_message'),
    metadata: jsonb('metadata').default({}),
    createdBy: uuid('created_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_lex_runs_shop_status').on(table.shopId, table.status),
    index('idx_lex_runs_shop_type_created').on(table.shopId, table.runType, table.createdAt),
    uniqueIndex('idx_lex_runs_single_active_per_shop')
      .on(table.shopId)
      .where(sql`${table.status} in ('pending', 'running', 'paused')`),
  ]
);

export const lexRunShards = pgTable(
  'lex_run_shards',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    runId: uuid('run_id')
      .notNull()
      .references(() => lexRuns.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    shardKey: varchar('shard_key', { length: 200 }).notNull(),
    phaseName: varchar('phase_name', { length: 50 }).notNull().default('extract.fragments'),
    sourceTable: varchar('source_table', { length: 50 }).notNull(),
    minSourceId: uuid('min_source_id'),
    maxSourceId: uuid('max_source_id'),
    status: varchar('status', { length: 20 }).default('pending'),
    retryCount: integer('retry_count').notNull().default(0),
    lastRetryAt: timestamp('last_retry_at', { withTimezone: true }),
    blockedReason: varchar('blocked_reason', { length: 50 }),
    checkpointCursor: jsonb('checkpoint_cursor').notNull().default({}),
    completedWithErrors: boolean('completed_with_errors').notNull().default(false),
    workerName: varchar('worker_name', { length: 100 }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    recordsRead: bigint('records_read', { mode: 'number' }).default(0),
    recordsWritten: bigint('records_written', { mode: 'number' }).default(0),
    errorMessage: text('error_message'),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_lex_run_shards_run_status').on(table.runId, table.status),
    index('idx_lex_run_shards_shop_source_status').on(
      table.shopId,
      table.sourceTable,
      table.status
    ),
    uniqueIndex('idx_lex_run_shards_phase_source_key').on(
      table.runId,
      table.phaseName,
      table.sourceTable,
      table.shardKey
    ),
  ]
);

export const lexCheckpoints = pgTable(
  'lex_checkpoints',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    runId: uuid('run_id')
      .notNull()
      .references(() => lexRuns.id, { onDelete: 'cascade' }),
    shardId: uuid('shard_id').references(() => lexRunShards.id, { onDelete: 'set null' }),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    workerName: varchar('worker_name', { length: 100 }).notNull(),
    checkpointType: varchar('checkpoint_type', { length: 50 }).notNull(),
    checkpointValue: jsonb('checkpoint_value').notNull(),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    status: varchar('status', { length: 20 }).default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_lex_checkpoints_run_worker_type').on(
      table.runId,
      table.workerName,
      table.checkpointType
    ),
    index('idx_lex_checkpoints_shop_worker_updated').on(
      table.shopId,
      table.workerName,
      table.updatedAt
    ),
  ]
);

export const lexSourceWatermarks = pgTable(
  'lex_source_watermarks',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    sourceTable: varchar('source_table', { length: 50 }).notNull(),
    phaseName: varchar('phase_name', { length: 50 }).notNull(),
    lastSuccessUpdatedAt: timestamp('last_success_updated_at', { withTimezone: true }),
    lastSuccessId: uuid('last_success_id'),
    snapshotHash: varchar('snapshot_hash', { length: 64 }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_lex_source_watermarks_unique').on(
      table.shopId,
      table.sourceTable,
      table.phaseName
    ),
    index('idx_lex_source_watermarks_shop_phase').on(table.shopId, table.phaseName),
  ]
);

export const lexRunPhaseEvents = pgTable(
  'lex_run_phase_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    runId: uuid('run_id')
      .notNull()
      .references(() => lexRuns.id, { onDelete: 'cascade' }),
    shardId: uuid('shard_id').references(() => lexRunShards.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    phaseName: varchar('phase_name', { length: 50 }).notNull(),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    details: jsonb('details').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_lex_run_phase_events_run_phase').on(table.runId, table.phaseName, table.createdAt),
    index('idx_lex_run_phase_events_shop_event').on(table.shopId, table.eventType, table.createdAt),
  ]
);

export const lexFragments = pgTable(
  'lex_fragments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    runId: uuid('run_id')
      .notNull()
      .references(() => lexRuns.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    sourceTable: varchar('source_table', { length: 50 }).notNull(),
    sourceRecordId: uuid('source_record_id').notNull(),
    sourceGid: varchar('source_gid', { length: 100 }),
    productId: uuid('product_id').references(() => shopifyProducts.id, { onDelete: 'set null' }),
    variantId: uuid('variant_id').references(() => shopifyVariants.id, { onDelete: 'set null' }),
    collectionId: uuid('collection_id').references(() => shopifyCollections.id, {
      onDelete: 'set null',
    }),
    masterProductId: uuid('master_product_id').references(() => prodMaster.id, {
      onDelete: 'set null',
    }),
    fieldPath: text('field_path').notNull(),
    fieldKind: varchar('field_kind', { length: 40 }).notNull(),
    rawText: text('raw_text').notNull(),
    cleanText: text('clean_text').notNull(),
    canonicalText: text('canonical_text').notNull(),
    languageGuess: varchar('language_guess', { length: 10 }).default('ro'),
    htmlStripped: boolean('html_stripped').default(false),
    tokenCount: integer('token_count').default(0),
    charCount: integer('char_count').default(0),
    vendorHint: varchar('vendor_hint', { length: 255 }),
    productTypeHint: varchar('product_type_hint', { length: 255 }),
    categoryHint: varchar('category_hint', { length: 255 }),
    taxonomyId: uuid('taxonomy_id').references(() => prodTaxonomy.id, { onDelete: 'set null' }),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    isNoise: boolean('is_noise').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_lex_fragments_shop_run').on(table.shopId, table.runId),
    index('idx_lex_fragments_shop_source_record').on(
      table.shopId,
      table.sourceTable,
      table.sourceRecordId
    ),
    index('idx_lex_fragments_shop_field_kind').on(table.shopId, table.fieldKind),
    index('idx_lex_fragments_shop_content_hash').on(table.shopId, table.contentHash),
    index('idx_lex_fragments_shop_created_at').on(table.shopId, table.createdAt),
    index('idx_lex_fragments_created_at_brin').using('brin', table.createdAt),
  ]
);

export const lexFragmentEntities = pgTable(
  'lex_fragment_entities',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    fragmentId: uuid('fragment_id')
      .notNull()
      .references(() => lexFragments.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    entityType: varchar('entity_type', { length: 40 }).notNull(),
    entityText: text('entity_text').notNull(),
    canonicalEntityText: text('canonical_entity_text').notNull(),
    normalizedValue: varchar('normalized_value', { length: 255 }),
    unit: varchar('unit', { length: 50 }),
    spanStart: integer('span_start'),
    spanEnd: integer('span_end'),
    confidenceScore: decimal('confidence_score', { precision: 5, scale: 4 }),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_lex_fragment_entities_fragment').on(table.fragmentId),
    index('idx_lex_fragment_entities_shop_type').on(table.shopId, table.entityType),
    index('idx_lex_fragment_entities_shop_canonical').on(table.shopId, table.canonicalEntityText),
  ]
);

export const lexFragmentAnnotations = pgTable(
  'lex_fragment_annotations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    fragmentId: uuid('fragment_id')
      .notNull()
      .references(() => lexFragments.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    annotationType: varchar('annotation_type', { length: 50 }).notNull(),
    annotationValue: jsonb('annotation_value').notNull(),
    source: varchar('source', { length: 30 }).default('system'),
    confidenceScore: decimal('confidence_score', { precision: 5, scale: 4 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_lex_fragment_annotations_fragment').on(table.fragmentId),
    index('idx_lex_fragment_annotations_shop_type').on(table.shopId, table.annotationType),
  ]
);

export const lexTerms = pgTable(
  'lex_terms',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    canonicalText: text('canonical_text').notNull(),
    normalizedKey: varchar('normalized_key', { length: 255 }).notNull(),
    displayTextRo: text('display_text_ro'),
    ngramSize: smallint('ngram_size').notNull(),
    termType: varchar('term_type', { length: 30 }).notNull(),
    domainCode: varchar('domain_code', { length: 100 }),
    isTechnical: boolean('is_technical').default(false),
    isProtected: boolean('is_protected').default(false),
    isStopword: boolean('is_stopword').default(false),
    isAttributeCandidate: boolean('is_attribute_candidate').default(false),
    isValueCandidate: boolean('is_value_candidate').default(false),
    isBrandCandidate: boolean('is_brand_candidate').default(false),
    translations: jsonb('translations').notNull().default({}),
    mergedIntoTermId: uuid('merged_into_term_id').references((): AnyPgColumn => lexTerms.id, {
      onDelete: 'set null',
    }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    status: varchar('status', { length: 20 }).default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_lex_terms_shop_normalized').on(table.shopId, table.normalizedKey, table.ngramSize),
    index('idx_lex_terms_shop_domain_status').on(table.shopId, table.domainCode, table.status),
    uniqueIndex('idx_lex_terms_shop_norm_ngram_unique_non_merged')
      .on(table.shopId, table.normalizedKey, table.ngramSize)
      .where(sql`${table.status} <> 'merged'`),
  ]
);

export const lexTermVariants = pgTable(
  'lex_term_variants',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    termId: uuid('term_id')
      .notNull()
      .references(() => lexTerms.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    variantText: text('variant_text').notNull(),
    normalizedVariant: varchar('normalized_variant', { length: 255 }).notNull(),
    locale: varchar('locale', { length: 10 }).default('ro'),
    script: varchar('script', { length: 20 }).default('latin'),
    variantType: varchar('variant_type', { length: 30 }).notNull(),
    source: varchar('source', { length: 30 }).default('extracted'),
    occurrenceCount: bigint('occurrence_count', { mode: 'number' }).default(0),
    isPreferred: boolean('is_preferred').default(false),
    isApproved: boolean('is_approved').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_lex_term_variants_term').on(table.termId),
    index('idx_lex_term_variants_shop_normalized').on(table.shopId, table.normalizedVariant),
    uniqueIndex('idx_lex_term_variants_term_norm_locale_unique').on(
      table.termId,
      table.normalizedVariant,
      table.locale
    ),
  ]
);

export const lexTermOccurrences = pgTable(
  'lex_term_occurrences',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    runId: uuid('run_id')
      .notNull()
      .references(() => lexRuns.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    termId: uuid('term_id')
      .notNull()
      .references(() => lexTerms.id, { onDelete: 'cascade' }),
    fragmentId: uuid('fragment_id')
      .notNull()
      .references(() => lexFragments.id, { onDelete: 'cascade' }),
    positionStart: integer('position_start').notNull(),
    positionEnd: integer('position_end').notNull(),
    sentenceIndex: integer('sentence_index'),
    tokenIndex: integer('token_index'),
    leftContext: text('left_context'),
    rightContext: text('right_context'),
    neighborTerms: text('neighbor_terms')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    contextHash: varchar('context_hash', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_lex_term_occurrences_shop_term').on(table.shopId, table.termId),
    index('idx_lex_term_occurrences_fragment').on(table.fragmentId),
    index('idx_lex_term_occurrences_shop_context_hash').on(table.shopId, table.contextHash),
    index('idx_lex_term_occurrences_run_term').on(table.runId, table.termId),
    index('idx_lex_term_occurrences_shop_created_at').on(table.shopId, table.createdAt),
    index('idx_lex_term_occurrences_created_at_brin').using('brin', table.createdAt),
  ]
);

export const lexTermStats = pgTable(
  'lex_term_stats',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    termId: uuid('term_id')
      .notNull()
      .references(() => lexTerms.id, { onDelete: 'cascade' }),
    lastRunId: uuid('last_run_id').references(() => lexRuns.id, { onDelete: 'set null' }),
    occurrencesTotal: bigint('occurrences_total', { mode: 'number' }).default(0),
    distinctFragments: bigint('distinct_fragments', { mode: 'number' }).default(0),
    distinctProducts: bigint('distinct_products', { mode: 'number' }).default(0),
    distinctVariants: bigint('distinct_variants', { mode: 'number' }).default(0),
    distinctCollections: bigint('distinct_collections', { mode: 'number' }).default(0),
    titleOccurrences: bigint('title_occurrences', { mode: 'number' }).default(0),
    descriptionOccurrences: bigint('description_occurrences', { mode: 'number' }).default(0),
    metafieldOccurrences: bigint('metafield_occurrences', { mode: 'number' }).default(0),
    vendorOccurrences: bigint('vendor_occurrences', { mode: 'number' }).default(0),
    scoreGlobal: decimal('score_global', { precision: 10, scale: 4 }),
    scoreTfidf: decimal('score_tfidf', { precision: 10, scale: 4 }),
    scoreDomain: decimal('score_domain', { precision: 10, scale: 4 }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_lex_term_stats_shop_term').on(table.shopId, table.termId),
    index('idx_lex_term_stats_shop_score_global').on(table.shopId, table.scoreGlobal),
    index('idx_lex_term_stats_shop_score_domain').on(table.shopId, table.scoreDomain),
  ]
);

export const lexTermContexts = pgTable(
  'lex_term_contexts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    termId: uuid('term_id')
      .notNull()
      .references(() => lexTerms.id, { onDelete: 'cascade' }),
    representativeText: text('representative_text').notNull(),
    contextHash: varchar('context_hash', { length: 64 }).notNull(),
    fieldKind: varchar('field_kind', { length: 40 }),
    vendorHint: varchar('vendor_hint', { length: 255 }),
    productTypeHint: varchar('product_type_hint', { length: 255 }),
    domainCode: varchar('domain_code', { length: 100 }),
    taxonomyId: uuid('taxonomy_id').references(() => prodTaxonomy.id, { onDelete: 'set null' }),
    collectionIds: uuid('collection_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    occurrencesCount: bigint('occurrences_count', { mode: 'number' }).default(1),
    sampleProductIds: uuid('sample_product_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    languageGuess: varchar('language_guess', { length: 10 }).default('ro'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_lex_term_contexts_shop_term_hash').on(
      table.shopId,
      table.termId,
      table.contextHash
    ),
    index('idx_lex_term_contexts_shop_domain').on(table.shopId, table.domainCode),
    index('idx_lex_term_contexts_shop_taxonomy').on(table.shopId, table.taxonomyId),
    index('idx_lex_term_contexts_shop_created_at').on(table.shopId, table.createdAt),
    index('idx_lex_term_contexts_created_at_brin').using('brin', table.createdAt),
  ]
);

export const lexContextEmbeddings = pgTable(
  'lex_context_embeddings',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    contextId: uuid('context_id')
      .notNull()
      .references(() => lexTermContexts.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 20 }).notNull(),
    modelName: varchar('model_name', { length: 100 }).notNull(),
    dimensions: integer('dimensions').notNull().default(2000),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    // embedding: vector(2000) + idx_lex_context_embeddings_hnsw — SQL migrations only; omitted from Drizzle to avoid unsafe drizzle-kit push DROP COLUMN.
    status: varchar('status', { length: 20 }).default('ready'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_lex_context_embeddings_context_model_hash').on(
      table.contextId,
      table.modelName,
      table.contentHash
    ),
    index('idx_lex_context_embeddings_shop_status').on(table.shopId, table.status),
  ]
);

export const lexSenseClusters = pgTable(
  'lex_sense_clusters',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    termId: uuid('term_id')
      .notNull()
      .references(() => lexTerms.id, { onDelete: 'cascade' }),
    clusterKey: varchar('cluster_key', { length: 100 }).notNull(),
    clusterMethod: varchar('cluster_method', { length: 30 }).notNull(),
    domainCode: varchar('domain_code', { length: 100 }),
    taxonomyId: uuid('taxonomy_id').references(() => prodTaxonomy.id, { onDelete: 'set null' }),
    labelRo: text('label_ro'),
    labelEn: text('label_en'),
    description: text('description'),
    originClusterId: uuid('origin_cluster_id').references((): AnyPgColumn => lexSenseClusters.id, {
      onDelete: 'set null',
    }),
    representativeContextId: uuid('representative_context_id').references(
      () => lexTermContexts.id,
      {
        onDelete: 'set null',
      }
    ),
    translations: jsonb('translations').notNull().default({}),
    confidenceScore: decimal('confidence_score', { precision: 5, scale: 4 }),
    needsReview: boolean('needs_review').default(false),
    isApproved: boolean('is_approved').default(false),
    createdBy: uuid('created_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_lex_sense_clusters_shop_term_key').on(
      table.shopId,
      table.termId,
      table.clusterKey
    ),
    index('idx_lex_sense_clusters_shop_term_approved').on(
      table.shopId,
      table.termId,
      table.isApproved
    ),
    index('idx_lex_sense_clusters_shop_domain').on(table.shopId, table.domainCode),
  ]
);

export const lexSenseClusterMembers = pgTable(
  'lex_sense_cluster_members',
  {
    clusterId: uuid('cluster_id')
      .notNull()
      .references(() => lexSenseClusters.id, { onDelete: 'cascade' }),
    contextId: uuid('context_id')
      .notNull()
      .references(() => lexTermContexts.id, { onDelete: 'cascade' }),
    similarityScore: decimal('similarity_score', { precision: 5, scale: 4 }),
    isRepresentative: boolean('is_representative').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.clusterId, table.contextId],
      name: 'lex_sense_cluster_members_pk',
    }),
    index('idx_lex_sense_cluster_members_context').on(table.contextId),
    index('idx_lex_sense_cluster_members_cluster_similarity').on(
      table.clusterId,
      table.similarityScore
    ),
  ]
);

export const lexDomainProfiles = pgTable(
  'lex_domain_profiles',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    domainCode: varchar('domain_code', { length: 100 }).notNull(),
    nameRo: varchar('name_ro', { length: 255 }).notNull(),
    nameEn: varchar('name_en', { length: 255 }),
    description: text('description'),
    categoryHints: jsonb('category_hints').default({}),
    protectedPatterns: jsonb('protected_patterns').default([]),
    requiredNeighborTerms: jsonb('required_neighbor_terms').default([]),
    forbiddenNeighborTerms: jsonb('forbidden_neighbor_terms').default([]),
    allowedTranslationStyles: jsonb('allowed_translation_styles').default([]),
    metadata: jsonb('metadata').default({}),
    translations: jsonb('translations').notNull().default({}),
    version: integer('version').notNull().default(1),
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [uniqueIndex('idx_lex_domain_profiles_shop_domain').on(table.shopId, table.domainCode)]
);

export const lexGlossaryEntries = pgTable(
  'lex_glossary_entries',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    domainCode: varchar('domain_code', { length: 100 }),
    sourceLang: varchar('source_lang', { length: 10 }).notNull(),
    targetLang: varchar('target_lang', { length: 10 }).notNull(),
    sourceText: text('source_text').notNull(),
    normalizedSourceText: varchar('normalized_source_text', { length: 255 }).notNull(),
    senseHint: varchar('sense_hint', { length: 255 }),
    targetText: text('target_text').notNull(),
    translationKind: varchar('translation_kind', { length: 30 }).notNull(),
    priority: integer('priority').default(100),
    version: integer('version').notNull().default(1),
    isLocked: boolean('is_locked').default(false),
    isActive: boolean('is_active').default(true),
    source: varchar('source', { length: 30 }).default('manual'),
    confidenceScore: decimal('confidence_score', { precision: 5, scale: 4 }).default('1.0'),
    notes: text('notes'),
    approvedBy: uuid('approved_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_lex_glossary_entries_shop_normalized').on(
      table.shopId,
      table.normalizedSourceText,
      table.sourceLang,
      table.targetLang
    ),
    index('idx_lex_glossary_entries_shop_domain_active').on(
      table.shopId,
      table.domainCode,
      table.isActive
    ),
    uniqueIndex('idx_lex_glossary_entries_shop_active_unique')
      .on(
        table.shopId,
        table.normalizedSourceText,
        table.sourceLang,
        table.targetLang,
        sql`COALESCE(${table.domainCode}, '')`,
        sql`COALESCE(${table.senseHint}, '')`
      )
      .where(sql`${table.shopId} IS NOT NULL AND ${table.isActive} = true`),
    uniqueIndex('idx_lex_glossary_entries_global_active_unique')
      .on(
        table.normalizedSourceText,
        table.sourceLang,
        table.targetLang,
        sql`COALESCE(${table.domainCode}, '')`,
        sql`COALESCE(${table.senseHint}, '')`
      )
      .where(sql`${table.shopId} IS NULL AND ${table.isActive} = true`),
  ]
);

export const lexTranslationRules = pgTable(
  'lex_translation_rules',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    ruleName: varchar('rule_name', { length: 255 }).notNull(),
    sourceLang: varchar('source_lang', { length: 10 }).notNull(),
    targetLang: varchar('target_lang', { length: 10 }).notNull(),
    matchTerm: text('match_term').notNull(),
    domainCode: varchar('domain_code', { length: 100 }),
    requiredNeighbors: jsonb('required_neighbors').default([]),
    forbiddenNeighbors: jsonb('forbidden_neighbors').default([]),
    requiredFieldKinds: jsonb('required_field_kinds').default([]),
    targetTranslation: text('target_translation').notNull(),
    priority: integer('priority').default(100),
    version: integer('version').notNull().default(1),
    isActive: boolean('is_active').default(true),
    createdBy: uuid('created_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_lex_translation_rules_shop_active').on(table.shopId, table.isActive, table.priority),
    index('idx_lex_translation_rules_shop_domain').on(table.shopId, table.domainCode),
  ]
);

export const lexTranslationCandidates = pgTable(
  'lex_translation_candidates',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    termId: uuid('term_id')
      .notNull()
      .references(() => lexTerms.id, { onDelete: 'cascade' }),
    clusterId: uuid('cluster_id').references(() => lexSenseClusters.id, { onDelete: 'set null' }),
    sourceLang: varchar('source_lang', { length: 10 }).notNull(),
    targetLang: varchar('target_lang', { length: 10 }).notNull(),
    candidateText: text('candidate_text').notNull(),
    alternativeTexts: text('alternative_texts')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    candidateSource: varchar('candidate_source', { length: 30 }).notNull(),
    providerBatchItemId: uuid('provider_batch_item_id').references(() => aiBatchItems.id, {
      onDelete: 'set null',
    }),
    confidenceScore: decimal('confidence_score', { precision: 5, scale: 4 }),
    justification: text('justification'),
    evidence: jsonb('evidence').default({}),
    rank: integer('rank').default(1),
    status: varchar('status', { length: 20 }).default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_lex_translation_candidates_shop_term_status').on(
      table.shopId,
      table.termId,
      table.status
    ),
    index('idx_lex_translation_candidates_cluster_rank').on(table.clusterId, table.rank),
    index('idx_lex_translation_candidates_provider_batch_item').on(table.providerBatchItemId),
    uniqueIndex('idx_lex_translation_candidates_shop_term_cluster_lang_rank').on(
      table.shopId,
      table.termId,
      sql`COALESCE(${table.clusterId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      table.sourceLang,
      table.targetLang,
      table.rank
    ),
  ]
);

export const lexTranslations = pgTable(
  'lex_translations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    termId: uuid('term_id')
      .notNull()
      .references(() => lexTerms.id, { onDelete: 'cascade' }),
    clusterId: uuid('cluster_id').references(() => lexSenseClusters.id, { onDelete: 'set null' }),
    sourceLang: varchar('source_lang', { length: 10 }).notNull(),
    targetLang: varchar('target_lang', { length: 10 }).notNull(),
    translationText: text('translation_text').notNull(),
    // source_embedding: vector(2000) — SQL migration 0119; omit from Drizzle to avoid unsafe push/drop.
    translationKind: varchar('translation_kind', { length: 30 }).notNull(),
    version: integer('version').notNull().default(1),
    qualityScore: decimal('quality_score', { precision: 5, scale: 4 }),
    sourceCandidateId: uuid('source_candidate_id').references(() => lexTranslationCandidates.id, {
      onDelete: 'set null',
    }),
    publicationStatus: varchar('publication_status', { length: 20 }).default('draft'),
    isLocked: boolean('is_locked').notNull().default(false),
    lockedBy: uuid('locked_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    approvedBy: uuid('approved_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_lex_translations_shop_term_cluster_lang').on(
      table.shopId,
      table.termId,
      table.clusterId,
      table.sourceLang,
      table.targetLang
    ),
    index('idx_lex_translations_publication_status').on(table.publicationStatus),
    index('idx_lex_translations_target_lang_kind').on(table.targetLang, table.translationKind),
  ]
);

export const lexAttributeResolutionCandidates = pgTable(
  'lex_attribute_resolution_candidates',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    termId: uuid('term_id')
      .notNull()
      .references(() => lexTerms.id, { onDelete: 'cascade' }),
    clusterId: uuid('cluster_id').references(() => lexSenseClusters.id, { onDelete: 'set null' }),
    definitionId: uuid('definition_id').references(() => prodAttrDefinitions.id, {
      onDelete: 'set null',
    }),
    resolutionRole: varchar('resolution_role', { length: 30 }).notNull(),
    confidenceScore: decimal('confidence_score', { precision: 5, scale: 4 }),
    evidence: jsonb('evidence').default({}),
    status: varchar('status', { length: 20 }).default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_lex_attr_resolution_candidates_shop_term').on(table.shopId, table.termId),
    index('idx_lex_attr_resolution_candidates_definition').on(table.definitionId),
    uniqueIndex('idx_lex_attr_resolution_candidates_business_key').on(
      table.shopId,
      table.termId,
      sql`COALESCE(${table.clusterId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`COALESCE(${table.definitionId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      table.resolutionRole
    ),
  ]
);

export const lexAttributeResolutions = pgTable(
  'lex_attribute_resolutions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    termId: uuid('term_id')
      .notNull()
      .references(() => lexTerms.id, { onDelete: 'cascade' }),
    clusterId: uuid('cluster_id').references(() => lexSenseClusters.id, { onDelete: 'set null' }),
    definitionId: uuid('definition_id')
      .notNull()
      .references(() => prodAttrDefinitions.id, { onDelete: 'cascade' }),
    resolutionRole: varchar('resolution_role', { length: 30 }).notNull(),
    version: integer('version').notNull().default(1),
    sourceCandidateId: uuid('source_candidate_id').references(
      () => lexAttributeResolutionCandidates.id,
      {
        onDelete: 'set null',
      }
    ),
    confidenceScore: decimal('confidence_score', { precision: 5, scale: 4 }),
    status: varchar('status', { length: 20 }).default('approved'),
    approvedBy: uuid('approved_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_lex_attribute_resolutions_shop_unique')
      .on(table.shopId, table.termId, table.clusterId, table.definitionId, table.resolutionRole)
      .where(sql`${table.shopId} IS NOT NULL`),
    uniqueIndex('idx_lex_attribute_resolutions_global_unique')
      .on(table.termId, table.clusterId, table.definitionId, table.resolutionRole)
      .where(sql`${table.shopId} IS NULL`),
    index('idx_lex_attribute_resolutions_shop_term').on(table.shopId, table.termId),
    index('idx_lex_attribute_resolutions_definition_role').on(
      table.definitionId,
      table.resolutionRole
    ),
  ]
);

/**
 * Effective-resolution views (global + shop override). DDL: `0116_lexical_module_hardening.sql`.
 * Each view projects the underlying table columns plus `rn` from `ROW_NUMBER()` (visible rows have `rn = 1`).
 * Registered with `pgView(...).existing()` so migrations remain the source of truth for `CREATE VIEW`.
 */
export const lexEffectiveTerms = pgView('lex_effective_terms', {
  id: uuid('id').notNull(),
  shopId: uuid('shop_id'),
  canonicalText: text('canonical_text').notNull(),
  normalizedKey: varchar('normalized_key', { length: 255 }).notNull(),
  displayTextRo: text('display_text_ro'),
  ngramSize: smallint('ngram_size').notNull(),
  termType: varchar('term_type', { length: 30 }).notNull(),
  domainCode: varchar('domain_code', { length: 100 }),
  isTechnical: boolean('is_technical'),
  isProtected: boolean('is_protected'),
  isStopword: boolean('is_stopword'),
  isAttributeCandidate: boolean('is_attribute_candidate'),
  isValueCandidate: boolean('is_value_candidate'),
  isBrandCandidate: boolean('is_brand_candidate'),
  mergedIntoTermId: uuid('merged_into_term_id'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  status: varchar('status', { length: 20 }),
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  rn: bigint('rn', { mode: 'number' }).notNull(),
}).existing();

export const lexEffectiveGlossaryEntries = pgView('lex_effective_glossary_entries', {
  id: uuid('id').notNull(),
  shopId: uuid('shop_id'),
  domainCode: varchar('domain_code', { length: 100 }),
  sourceLang: varchar('source_lang', { length: 10 }).notNull(),
  targetLang: varchar('target_lang', { length: 10 }).notNull(),
  sourceText: text('source_text').notNull(),
  normalizedSourceText: varchar('normalized_source_text', { length: 255 }).notNull(),
  senseHint: varchar('sense_hint', { length: 255 }),
  targetText: text('target_text').notNull(),
  translationKind: varchar('translation_kind', { length: 30 }).notNull(),
  priority: integer('priority'),
  version: integer('version').notNull(),
  isLocked: boolean('is_locked'),
  isActive: boolean('is_active'),
  source: varchar('source', { length: 30 }),
  confidenceScore: decimal('confidence_score', { precision: 5, scale: 4 }),
  notes: text('notes'),
  approvedBy: uuid('approved_by'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  rn: bigint('rn', { mode: 'number' }).notNull(),
}).existing();

export const lexEffectiveTranslationRules = pgView('lex_effective_translation_rules', {
  id: uuid('id').notNull(),
  shopId: uuid('shop_id'),
  ruleName: varchar('rule_name', { length: 255 }).notNull(),
  sourceLang: varchar('source_lang', { length: 10 }).notNull(),
  targetLang: varchar('target_lang', { length: 10 }).notNull(),
  matchTerm: text('match_term').notNull(),
  domainCode: varchar('domain_code', { length: 100 }),
  requiredNeighbors: jsonb('required_neighbors'),
  forbiddenNeighbors: jsonb('forbidden_neighbors'),
  requiredFieldKinds: jsonb('required_field_kinds'),
  targetTranslation: text('target_translation').notNull(),
  priority: integer('priority'),
  version: integer('version').notNull(),
  isActive: boolean('is_active'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  rn: bigint('rn', { mode: 'number' }).notNull(),
}).existing();

export const lexEffectiveTranslations = pgView('lex_effective_translations', {
  id: uuid('id').notNull(),
  shopId: uuid('shop_id'),
  termId: uuid('term_id').notNull(),
  clusterId: uuid('cluster_id'),
  sourceLang: varchar('source_lang', { length: 10 }).notNull(),
  targetLang: varchar('target_lang', { length: 10 }).notNull(),
  translationText: text('translation_text').notNull(),
  translationKind: varchar('translation_kind', { length: 30 }).notNull(),
  version: integer('version').notNull(),
  qualityScore: decimal('quality_score', { precision: 5, scale: 4 }),
  sourceCandidateId: uuid('source_candidate_id'),
  publicationStatus: varchar('publication_status', { length: 20 }),
  isLocked: boolean('is_locked').notNull(),
  lockedBy: uuid('locked_by'),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  rn: bigint('rn', { mode: 'number' }).notNull(),
}).existing();

export const lexEffectiveAttributeResolutions = pgView('lex_effective_attribute_resolutions', {
  id: uuid('id').notNull(),
  shopId: uuid('shop_id'),
  termId: uuid('term_id').notNull(),
  clusterId: uuid('cluster_id'),
  definitionId: uuid('definition_id').notNull(),
  resolutionRole: varchar('resolution_role', { length: 30 }).notNull(),
  version: integer('version').notNull(),
  sourceCandidateId: uuid('source_candidate_id'),
  confidenceScore: decimal('confidence_score', { precision: 5, scale: 4 }),
  status: varchar('status', { length: 20 }),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  rn: bigint('rn', { mode: 'number' }).notNull(),
}).existing();

export const lexReviewItems = pgTable(
  'lex_review_items',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => lexRuns.id, { onDelete: 'set null' }),
    entityType: varchar('entity_type', { length: 30 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    reviewReason: varchar('review_reason', { length: 100 }).notNull(),
    severity: varchar('severity', { length: 20 }).default('medium'),
    priority: integer('priority').default(100),
    version: integer('version').notNull().default(1),
    status: varchar('status', { length: 20 }).default('pending'),
    assignedTo: uuid('assigned_to').references(() => staffUsers.id, { onDelete: 'set null' }),
    assignmentNotes: text('assignment_notes'),
    evidence: jsonb('evidence').default({}),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_lex_review_items_shop_status_priority').on(
      table.shopId,
      table.status,
      table.priority
    ),
    index('idx_lex_review_items_shop_entity').on(table.shopId, table.entityType, table.entityId),
    /** Matches migration 0127 — one open row per (shop, entity, reason). */
    uniqueIndex('idx_lex_review_items_shop_entity_reason_open_unique')
      .on(table.shopId, table.entityType, table.entityId, table.reviewReason)
      .where(sql`${table.status} IN ('pending', 'in_review')`),
  ]
);

export const lexDecisions = pgTable(
  'lex_decisions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    reviewItemId: uuid('review_item_id').references(() => lexReviewItems.id, {
      onDelete: 'set null',
    }),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    entityType: varchar('entity_type', { length: 30 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    decisionType: varchar('decision_type', { length: 30 }).notNull(),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    decidedBy: uuid('decided_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    decisionNotes: text('decision_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_lex_decisions_review_item').on(table.reviewItemId),
    index('idx_lex_decisions_shop_entity').on(table.shopId, table.entityType, table.entityId),
  ]
);

export const lexEntityLocalizations = pgTable(
  'lex_entity_localizations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    entityType: varchar('entity_type', { length: 30 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    sourceLang: varchar('source_lang', { length: 10 }).notNull(),
    targetLang: varchar('target_lang', { length: 10 }).notNull(),
    titleText: text('title_text'),
    descriptionText: text('description_text'),
    descriptionShort: varchar('description_short', { length: 500 }),
    seoTitle: varchar('seo_title', { length: 255 }),
    seoDescription: text('seo_description'),
    keywords: text('keywords')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    version: integer('version').notNull().default(1),
    qualityScore: decimal('quality_score', { precision: 5, scale: 4 }),
    publicationStatus: varchar('publication_status', { length: 20 }).default('draft'),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    sourceRunId: uuid('source_run_id').references(() => lexRuns.id, { onDelete: 'set null' }),
    approvedBy: uuid('approved_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_lex_entity_localizations_unique').on(
      table.shopId,
      table.entityType,
      table.entityId,
      table.sourceLang,
      table.targetLang
    ),
    index('idx_lex_entity_localizations_shop_status').on(table.shopId, table.publicationStatus),
    index('idx_lex_entity_localizations_shop_entity').on(
      table.shopId,
      table.entityType,
      table.entityId
    ),
  ]
);

export const lexEntityLocalizationEvidence = pgTable(
  'lex_entity_localization_evidence',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    localizationId: uuid('localization_id')
      .notNull()
      .references(() => lexEntityLocalizations.id, { onDelete: 'cascade' }),
    fragmentId: uuid('fragment_id').references(() => lexFragments.id, { onDelete: 'set null' }),
    clusterId: uuid('cluster_id').references(() => lexSenseClusters.id, { onDelete: 'set null' }),
    translationId: uuid('translation_id').references(() => lexTranslations.id, {
      onDelete: 'set null',
    }),
    sourceOrder: integer('source_order').default(0),
    evidenceType: varchar('evidence_type', { length: 40 }).notNull(),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_lex_entity_localization_evidence_shop').on(table.shopId),
    index('idx_lex_entity_localization_evidence_localization').on(table.localizationId),
    index('idx_lex_entity_localization_evidence_fragment').on(table.fragmentId),
  ]
);

export const lexPublicationTargets = pgTable(
  'lex_publication_targets',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    translationId: uuid('translation_id').references(() => lexTranslations.id, {
      onDelete: 'set null',
    }),
    localizationId: uuid('localization_id').references(() => lexEntityLocalizations.id, {
      onDelete: 'set null',
    }),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    targetType: varchar('target_type', { length: 40 }).notNull(),
    targetRecordId: uuid('target_record_id'),
    targetPath: text('target_path'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    targetSnapshotHash: varchar('target_snapshot_hash', { length: 64 }),
    status: varchar('status', { length: 20 }).default('pending'),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').default(0),
    errorMessage: text('error_message'),
    lastEventId: uuid('last_event_id'),
    publishedSnapshot: jsonb('published_snapshot'),
    previousSnapshot: jsonb('previous_snapshot'),
    payload: jsonb('payload').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_lex_publication_targets_status').on(table.status),
    index('idx_lex_publication_targets_shop_target').on(table.shopId, table.targetType),
    uniqueIndex('idx_lex_publication_targets_business_key').on(
      sql`COALESCE(${table.localizationId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      table.targetType,
      sql`COALESCE(${table.targetRecordId}::text, ${table.targetPath}, '')`,
      sql`COALESCE(${table.targetSnapshotHash}, '')`
    ),
  ]
);

export const lexPublishEvents = pgTable(
  'lex_publish_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    publicationTargetId: uuid('publication_target_id')
      .notNull()
      .references(() => lexPublicationTargets.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    action: varchar('action', { length: 20 }).notNull(),
    requestPayload: jsonb('request_payload'),
    responsePayload: jsonb('response_payload'),
    status: varchar('status', { length: 20 }).notNull(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_lex_publish_events_target').on(table.publicationTargetId),
    index('idx_lex_publish_events_shop_status').on(table.shopId, table.status),
    index('idx_lex_publish_events_created_at_brin').using('brin', table.createdAt),
  ]
);

export const lexStopwords = pgTable(
  'lex_stopwords',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    locale: varchar('locale', { length: 10 }).notNull(),
    word: varchar('word', { length: 255 }).notNull(),
    wordType: varchar('word_type', { length: 30 }).notNull(),
    priority: integer('priority').default(100),
    version: integer('version').notNull().default(1),
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_lex_stopwords_shop_locale_word').on(table.shopId, table.locale, table.word),
    uniqueIndex('idx_lex_stopwords_shop_locale_word_unique')
      .on(table.shopId, table.locale, table.word)
      .where(sql`${table.shopId} IS NOT NULL`),
    uniqueIndex('idx_lex_stopwords_global_locale_word_unique')
      .on(table.locale, table.word)
      .where(sql`${table.shopId} IS NULL`),
  ]
);

export const lexGovernanceRequests = pgTable(
  'lex_governance_requests',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    entityType: varchar('entity_type', { length: 40 }).notNull(),
    requestScope: varchar('request_scope', { length: 20 }).notNull().default('global'),
    targetId: uuid('target_id'),
    title: varchar('title', { length: 255 }),
    version: integer('version').notNull().default(1),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    proposedPayload: jsonb('proposed_payload').notNull().default({}),
    proposedHash: varchar('proposed_hash', { length: 64 }).notNull(),
    createdBy: uuid('created_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    submittedBy: uuid('submitted_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    approvedBy: uuid('approved_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    rejectedBy: uuid('rejected_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    appliedBy: uuid('applied_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    notes: text('notes'),
    rejectionReason: text('rejection_reason'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_lex_governance_requests_shop_status').on(
      table.shopId,
      table.status,
      table.createdAt
    ),
    index('idx_lex_governance_requests_entity').on(table.entityType, table.status, table.createdAt),
    uniqueIndex('idx_lex_governance_requests_non_terminal_dedupe')
      .on(
        table.shopId,
        table.entityType,
        sql`COALESCE(${table.targetId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        table.proposedHash
      )
      .where(sql`${table.status} IN ('draft', 'pending_approval', 'approved')`),
  ]
);

export const lexGovernanceRequestEvents = pgTable(
  'lex_governance_request_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    requestId: uuid('request_id')
      .notNull()
      .references(() => lexGovernanceRequests.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => staffUsers.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 20 }).notNull(),
    fromStatus: varchar('from_status', { length: 20 }),
    toStatus: varchar('to_status', { length: 20 }),
    details: jsonb('details').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_lex_governance_request_events_request').on(table.requestId, table.createdAt),
    index('idx_lex_governance_request_events_shop_action').on(
      table.shopId,
      table.action,
      table.createdAt
    ),
  ]
);

export type LexShopSetting = typeof lexShopSettings.$inferSelect;
export type NewLexShopSetting = typeof lexShopSettings.$inferInsert;
export type LexRun = typeof lexRuns.$inferSelect;
export type NewLexRun = typeof lexRuns.$inferInsert;
export type LexRunShard = typeof lexRunShards.$inferSelect;
export type NewLexRunShard = typeof lexRunShards.$inferInsert;
export type LexCheckpoint = typeof lexCheckpoints.$inferSelect;
export type NewLexCheckpoint = typeof lexCheckpoints.$inferInsert;
export type LexSourceWatermark = typeof lexSourceWatermarks.$inferSelect;
export type NewLexSourceWatermark = typeof lexSourceWatermarks.$inferInsert;
export type LexRunPhaseEvent = typeof lexRunPhaseEvents.$inferSelect;
export type NewLexRunPhaseEvent = typeof lexRunPhaseEvents.$inferInsert;
export type LexFragment = typeof lexFragments.$inferSelect;
export type NewLexFragment = typeof lexFragments.$inferInsert;
export type LexFragmentEntity = typeof lexFragmentEntities.$inferSelect;
export type NewLexFragmentEntity = typeof lexFragmentEntities.$inferInsert;
export type LexFragmentAnnotation = typeof lexFragmentAnnotations.$inferSelect;
export type NewLexFragmentAnnotation = typeof lexFragmentAnnotations.$inferInsert;
export type LexTerm = typeof lexTerms.$inferSelect;
export type NewLexTerm = typeof lexTerms.$inferInsert;
export type LexTermVariant = typeof lexTermVariants.$inferSelect;
export type NewLexTermVariant = typeof lexTermVariants.$inferInsert;
export type LexTermOccurrence = typeof lexTermOccurrences.$inferSelect;
export type NewLexTermOccurrence = typeof lexTermOccurrences.$inferInsert;
export type LexTermStat = typeof lexTermStats.$inferSelect;
export type NewLexTermStat = typeof lexTermStats.$inferInsert;
export type LexTermContext = typeof lexTermContexts.$inferSelect;
export type NewLexTermContext = typeof lexTermContexts.$inferInsert;
export type LexContextEmbedding = typeof lexContextEmbeddings.$inferSelect;
export type NewLexContextEmbedding = typeof lexContextEmbeddings.$inferInsert;
export type LexSenseCluster = typeof lexSenseClusters.$inferSelect;
export type NewLexSenseCluster = typeof lexSenseClusters.$inferInsert;
export type LexSenseClusterMember = typeof lexSenseClusterMembers.$inferSelect;
export type NewLexSenseClusterMember = typeof lexSenseClusterMembers.$inferInsert;
export type LexDomainProfile = typeof lexDomainProfiles.$inferSelect;
export type NewLexDomainProfile = typeof lexDomainProfiles.$inferInsert;
export type LexGlossaryEntry = typeof lexGlossaryEntries.$inferSelect;
export type NewLexGlossaryEntry = typeof lexGlossaryEntries.$inferInsert;
export type LexTranslationRule = typeof lexTranslationRules.$inferSelect;
export type NewLexTranslationRule = typeof lexTranslationRules.$inferInsert;
export type LexTranslationCandidate = typeof lexTranslationCandidates.$inferSelect;
export type NewLexTranslationCandidate = typeof lexTranslationCandidates.$inferInsert;
export type LexTranslation = typeof lexTranslations.$inferSelect;
export type NewLexTranslation = typeof lexTranslations.$inferInsert;
export type LexAttributeResolutionCandidate = typeof lexAttributeResolutionCandidates.$inferSelect;
export type NewLexAttributeResolutionCandidate =
  typeof lexAttributeResolutionCandidates.$inferInsert;
export type LexAttributeResolution = typeof lexAttributeResolutions.$inferSelect;
export type NewLexAttributeResolution = typeof lexAttributeResolutions.$inferInsert;
export type LexReviewItem = typeof lexReviewItems.$inferSelect;
export type NewLexReviewItem = typeof lexReviewItems.$inferInsert;
export type LexDecision = typeof lexDecisions.$inferSelect;
export type NewLexDecision = typeof lexDecisions.$inferInsert;
export type LexEntityLocalization = typeof lexEntityLocalizations.$inferSelect;
export type NewLexEntityLocalization = typeof lexEntityLocalizations.$inferInsert;
export type LexEntityLocalizationEvidence = typeof lexEntityLocalizationEvidence.$inferSelect;
export type NewLexEntityLocalizationEvidence = typeof lexEntityLocalizationEvidence.$inferInsert;
export type LexPublicationTarget = typeof lexPublicationTargets.$inferSelect;
export type NewLexPublicationTarget = typeof lexPublicationTargets.$inferInsert;
export type LexPublishEvent = typeof lexPublishEvents.$inferSelect;
export type NewLexPublishEvent = typeof lexPublishEvents.$inferInsert;
export type LexStopword = typeof lexStopwords.$inferSelect;
export type NewLexStopword = typeof lexStopwords.$inferInsert;
export type LexGovernanceRequest = typeof lexGovernanceRequests.$inferSelect;
export type NewLexGovernanceRequest = typeof lexGovernanceRequests.$inferInsert;
export type LexGovernanceRequestEvent = typeof lexGovernanceRequestEvents.$inferSelect;
export type NewLexGovernanceRequestEvent = typeof lexGovernanceRequestEvents.$inferInsert;

/** Row from `lex_effective_terms` (see `lexEffectiveTerms`). */
export type LexEffectiveTerm = LexTerm & { rn: number };
/** Row from `lex_effective_glossary_entries`. */
export type LexEffectiveGlossaryEntry = LexGlossaryEntry & { rn: number };
/** Row from `lex_effective_translation_rules`. */
export type LexEffectiveTranslationRule = LexTranslationRule & { rn: number };
/**
 * Row from `lex_effective_translations`.
 * Note: DB `SELECT *` may include `source_embedding` (vector); it is omitted from `lexTranslations` / this type — see column comment on `lexTranslations`.
 */
export type LexEffectiveTranslation = LexTranslation & { rn: number };
/** Row from `lex_effective_attribute_resolutions`. */
export type LexEffectiveAttributeResolution = LexAttributeResolution & { rn: number };

export const lexGuardrailsEvents = pgTable(
  'lex_guardrails_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    pipelinePhase: varchar('pipeline_phase', { length: 40 }).notNull(),
    scanPoint: varchar('scan_point', { length: 40 }).notNull(),
    verdict: varchar('verdict', { length: 20 }).notNull().default('pass'),
    reasons: text('reasons')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    inputHash: varchar('input_hash', { length: 64 }).notNull(),
    outputHash: varchar('output_hash', { length: 64 }),
    entityId: uuid('entity_id'),
    entityType: varchar('entity_type', { length: 40 }),
    termId: uuid('term_id').references(() => lexTerms.id, { onDelete: 'set null' }),
    runId: uuid('run_id').references(() => lexRuns.id, { onDelete: 'set null' }),
    shardIdx: integer('shard_idx'),
    confidenceScore: decimal('confidence_score', { precision: 5, scale: 4 }),
    metadata: jsonb('metadata').notNull().default({}),
    isFalsePositive: boolean('is_false_positive').notNull().default(false),
    reviewedBy: uuid('reviewed_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_lex_guardrails_events_shop_created').on(table.shopId, table.createdAt),
    index('idx_lex_guardrails_events_shop_verdict')
      .on(table.shopId, table.verdict)
      .where(sql`${table.verdict} != 'pass'`),
    index('idx_lex_guardrails_events_shop_phase_scan').on(
      table.shopId,
      table.pipelinePhase,
      table.scanPoint
    ),
    index('idx_lex_guardrails_events_term')
      .on(table.termId)
      .where(sql`${table.termId} IS NOT NULL`),
    index('idx_lex_guardrails_events_run')
      .on(table.runId)
      .where(sql`${table.runId} IS NOT NULL`),
    index('idx_lex_guardrails_events_false_positive')
      .on(table.shopId, table.isFalsePositive)
      .where(sql`${table.isFalsePositive} = true`),
  ]
);

export type LexGuardrailsEvent = typeof lexGuardrailsEvents.$inferSelect;
export type NewLexGuardrailsEvent = typeof lexGuardrailsEvents.$inferInsert;
