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

import { prodMaster, prodSources } from './pim.ts';
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
    sourceTitle: text('source_title'),
    sourceGtin: varchar('source_gtin', { length: 50 }),
    sourceSku: varchar('source_sku', { length: 100 }),
    sourcePrice: decimal('source_price', { precision: 12, scale: 2 }),
    sourceCurrency: varchar('source_currency', { length: 3 }),
    sourceData: jsonb('source_data'),

    similarityScore: decimal('similarity_score', { precision: 3, scale: 2 }).notNull(),
    matchMethod: varchar('match_method', { length: 50 }).notNull(),
    matchConfidence: varchar('match_confidence', { length: 20 }).default('pending'),
    isPrimarySource: boolean('is_primary_source').default(false),

    verifiedBy: uuid('verified_by').references(() => staffUsers.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_similarity_product').on(table.productId, table.similarityScore),
    index('idx_similarity_source').on(table.sourceId),
    index('idx_similarity_gtin').on(table.sourceGtin),
    index('idx_similarity_score').on(table.similarityScore),
    index('idx_similarity_pending').on(table.matchConfidence),
  ]
);

export type ProdSimilarityMatch = typeof prodSimilarityMatches.$inferSelect;
export type NewProdSimilarityMatch = typeof prodSimilarityMatches.$inferInsert;
