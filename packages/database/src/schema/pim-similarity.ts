/**
 * Module D: Global PIM - prod_similarity_matches
 *
 * CONFORM: 0026_pim_additional_tables.sql
 * Purpose: External product matches from web research
 */

import {
  pgTable,
  uuid,
  text,
  varchar,
  decimal,
  boolean,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { prodExtractionSessions, prodMaster, prodSources } from './pim.ts';
import { staffUsers } from './staff-users.ts';

export const prodSimilarityMatches = pgTable(
  'prod_similarity_matches',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    productId: uuid('product_id').references(() => prodMaster.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id').references(() => prodSources.id),

    sourceUrl: text('source_url').notNull(),
    sourceProductId: varchar('source_product_id', { length: 255 }),
    sourceTitle: text('source_title'),
    sourceGtin: varchar('source_gtin', { length: 50 }),
    sourceBrand: varchar('source_brand', { length: 255 }),
    sourceSku: varchar('source_sku', { length: 100 }),
    sourcePrice: decimal('source_price', { precision: 12, scale: 2 }),
    sourceCurrency: varchar('source_currency', { length: 3 }),
    sourceData: jsonb('source_data'),

    similarityScore: decimal('similarity_score', { precision: 5, scale: 4 }).notNull(),
    matchMethod: varchar('match_method', { length: 50 }).notNull(),
    matchConfidence: varchar('match_confidence', { length: 20 }).default('pending'),
    matchDetails: jsonb('match_details').default({}),
    isPrimarySource: boolean('is_primary_source').default(false),

    extractionSessionId: uuid('extraction_session_id').references(() => prodExtractionSessions.id),
    specsExtracted: jsonb('specs_extracted'),
    scrapedAt: timestamp('scraped_at', { withTimezone: true }),

    verifiedBy: uuid('verified_by').references(() => staffUsers.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    validationNotes: text('validation_notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_similarity_product').on(table.productId, table.similarityScore),
    index('idx_similarity_source').on(table.sourceId),
    index('idx_similarity_gtin').on(table.sourceGtin),
    index('idx_similarity_score').on(table.similarityScore),
    index('idx_similarity_pending').on(table.matchConfidence),
    index('idx_similarity_method').on(table.matchMethod, table.matchConfidence),
    index('idx_similarity_confirmed').on(
      table.productId,
      table.isPrimarySource,
      table.matchConfidence
    ),
    index('idx_similarity_url').on(table.sourceUrl),
  ]
);

export type ProdSimilarityMatch = typeof prodSimilarityMatches.$inferSelect;
export type NewProdSimilarityMatch = typeof prodSimilarityMatches.$inferInsert;
