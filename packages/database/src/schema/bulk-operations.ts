/**
 * Module C: Bulk Operations - bulk_runs & bulk_steps tables
 *
 * CONFORM: Database_Schema_Complete.md v2.6
 *
 * bulk_runs: Orchestrează operațiuni bulk Shopify
 * bulk_steps: Track individual steps (download, parse, upsert)
 *
 * Ambele tabele au RLS cu shop_id isolation.
 */

import {
  pgTable,
  uuid,
  text,
  varchar,
  bigint,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { shops } from './shops.ts';

// ============================================
// Table: bulk_runs
// ============================================
export const bulkRuns = pgTable(
  'bulk_runs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    // Operation type
    operationType: varchar('operation_type', { length: 50 }).notNull(),

    // Query type (GraphQL query)
    queryType: varchar('query_type', { length: 50 }),

    // Status
    status: varchar('status', { length: 20 }).notNull().default('pending'),

    // Shopify bulk operation reference
    shopifyOperationId: varchar('shopify_operation_id', { length: 100 }),

    // API version used
    apiVersion: varchar('api_version', { length: 20 }),

    // URLs
    pollingUrl: text('polling_url'),
    resultUrl: text('result_url'),
    partialDataUrl: text('partial_data_url'),

    // Result metadata
    resultSizeBytes: bigint('result_size_bytes', { mode: 'number' }),

    // Query hash for caching/analysis
    graphqlQueryHash: varchar('graphql_query_hash', { length: 64 }),

    // Cancellation tracking
    cancelledBy: uuid('cancelled_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),

    // Cost estimate (Shopify query cost points)
    costEstimate: integer('cost_estimate'),

    // Idempotency (active-only uniqueness enforced via partial index)
    idempotencyKey: varchar('idempotency_key', { length: 100 }),

    // Cursor state for pagination
    cursorState: jsonb('cursor_state'),

    // Timing
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    // Progress
    recordsProcessed: integer('records_processed').default(0),
    bytesProcessed: bigint('bytes_processed', { mode: 'number' }).default(0),

    // Error handling
    errorMessage: text('error_message'),
    retryCount: integer('retry_count').default(0),
    maxRetries: integer('max_retries').default(3),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_bulk_runs_shop_status').on(table.shopId, table.status),
    index('idx_bulk_runs_shopify_op').on(table.shopifyOperationId),
    index('idx_bulk_runs_idempotency')
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    // CRITICAL: Prevent multiple concurrent active runs per shop.
    uniqueIndex('idx_bulk_runs_active_shop')
      .on(table.shopId)
      .where(sql`${table.status} in ('pending', 'running')`),
    // Prevent duplicate active runs with same idempotency key per shop.
    uniqueIndex('idx_bulk_runs_active_idempotency')
      .on(table.shopId, table.idempotencyKey)
      .where(sql`${table.status} in ('pending', 'running')`),
    index('idx_bulk_runs_query_hash')
      .on(table.graphqlQueryHash)
      .where(sql`${table.graphqlQueryHash} is not null`),
  ]
);

export type BulkRun = typeof bulkRuns.$inferSelect;
export type NewBulkRun = typeof bulkRuns.$inferInsert;

// ============================================
// Table: bulk_steps
// ============================================
export const bulkSteps = pgTable(
  'bulk_steps',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    bulkRunId: uuid('bulk_run_id')
      .notNull()
      .references(() => bulkRuns.id, { onDelete: 'cascade' }),

    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    // Step info
    stepName: varchar('step_name', { length: 100 }).notNull(),
    stepOrder: integer('step_order').default(0),

    // Status
    status: varchar('status', { length: 20 }).notNull().default('pending'),

    // Timing
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    // Progress
    recordsProcessed: integer('records_processed').default(0),
    recordsFailed: integer('records_failed').default(0),

    // Error handling
    errorMessage: text('error_message'),
    errorDetails: jsonb('error_details'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_bulk_steps_run').on(table.bulkRunId),
    index('idx_bulk_steps_shop_status').on(table.shopId, table.status),
  ]
);

export type BulkStep = typeof bulkSteps.$inferSelect;
export type NewBulkStep = typeof bulkSteps.$inferInsert;

// ============================================
// Table: bulk_artifacts
// ============================================
export const bulkArtifacts = pgTable(
  'bulk_artifacts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    bulkRunId: uuid('bulk_run_id')
      .notNull()
      .references(() => bulkRuns.id, { onDelete: 'cascade' }),

    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    artifactType: varchar('artifact_type', { length: 50 }).notNull(),
    filePath: text('file_path').notNull(),

    url: text('url'),
    bytesSize: bigint('bytes_size', { mode: 'number' }),
    rowsCount: integer('rows_count'),
    checksum: varchar('checksum', { length: 64 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [index('idx_bulk_artifacts_run').on(table.bulkRunId)]
);

export type BulkArtifact = typeof bulkArtifacts.$inferSelect;
export type NewBulkArtifact = typeof bulkArtifacts.$inferInsert;

// ============================================
// Table: bulk_errors
// ============================================
export const bulkErrors = pgTable(
  'bulk_errors',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    bulkRunId: uuid('bulk_run_id')
      .notNull()
      .references(() => bulkRuns.id, { onDelete: 'cascade' }),

    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    errorType: varchar('error_type', { length: 50 }).notNull(),
    errorCode: varchar('error_code', { length: 50 }),
    errorMessage: text('error_message').notNull(),
    lineNumber: integer('line_number'),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_bulk_errors_run').on(table.bulkRunId),
    index('idx_bulk_errors_type').on(table.shopId, table.errorType),
  ]
);

export type BulkError = typeof bulkErrors.$inferSelect;
export type NewBulkError = typeof bulkErrors.$inferInsert;
