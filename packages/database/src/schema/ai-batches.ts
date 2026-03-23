/**
 * AI batch tables (Module F) — mirrored from SQL migrations 0027+ for Drizzle FK references from lexical module.
 * CHECK constraints and RLS live in SQL; do not use drizzle-kit push against prod without reviewing diffs.
 */

import { sql } from 'drizzle-orm';
import {
  decimal,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { shops } from './shops.ts';

export const aiBatches = pgTable(
  'ai_batches',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 20 }).notNull(),
    providerBatchId: varchar('provider_batch_id', { length: 100 }),
    batchType: varchar('batch_type', { length: 50 }).notNull(),
    status: varchar('status', { length: 20 }).default('pending'),
    requestCount: integer('request_count').notNull().default(0),
    completedCount: integer('completed_count').default(0),
    errorCount: integer('error_count').default(0),
    totalTokens: integer('total_tokens').default(0),
    estimatedCost: decimal('estimated_cost', { precision: 10, scale: 4 }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_ai_batches_provider').on(table.providerBatchId),
    index('idx_ai_batches_status').on(table.status),
    index('idx_ai_batches_shop').on(table.shopId),
  ]
);

export const aiBatchItems = pgTable(
  'ai_batch_items',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => aiBatches.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    customId: varchar('custom_id', { length: 100 }),
    inputContent: text('input_content').notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    status: varchar('status', { length: 20 }).default('pending'),
    outputContent: text('output_content'),
    tokensUsed: integer('tokens_used'),
    errorMessage: text('error_message'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_batch_items_batch').on(table.batchId),
    index('idx_batch_items_entity').on(table.entityType, table.entityId),
    index('idx_batch_items_hash').on(table.contentHash),
    index('idx_batch_items_status').on(table.batchId, table.status),
  ]
);

export type AiBatch = typeof aiBatches.$inferSelect;
export type NewAiBatch = typeof aiBatches.$inferInsert;
export type AiBatchItem = typeof aiBatchItems.$inferSelect;
export type NewAiBatchItem = typeof aiBatchItems.$inferInsert;
