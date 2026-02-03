/**
 * Module H: Audit & Observability - api_usage_log
 *
 * CONFORM: 0033_api_usage_analytics.sql
 * Purpose: Track external API usage and costs
 */

import {
  pgTable,
  uuid,
  varchar,
  integer,
  decimal,
  timestamp,
  text,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { prodMaster } from './pim.ts';
import { shops } from './shops.ts';

export const apiUsageLog = pgTable(
  'api_usage_log',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    apiProvider: varchar('api_provider', { length: 50 }).notNull(),
    endpoint: varchar('endpoint', { length: 100 }).notNull(),
    requestCount: integer('request_count').notNull().default(1),
    tokensInput: integer('tokens_input'),
    tokensOutput: integer('tokens_output'),
    estimatedCost: decimal('estimated_cost', { precision: 10, scale: 4 }),
    httpStatus: integer('http_status'),
    responseTimeMs: integer('response_time_ms'),
    jobId: varchar('job_id', { length: 255 }),
    productId: uuid('product_id').references(() => prodMaster.id, { onDelete: 'set null' }),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'set null' }),
    errorMessage: text('error_message'),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_api_usage_provider_date').on(table.apiProvider, table.createdAt),
    index('idx_api_usage_product').on(table.productId),
    index('idx_api_usage_shop').on(table.shopId, table.createdAt),
  ]
);

export type ApiUsageLog = typeof apiUsageLog.$inferSelect;
export type NewApiUsageLog = typeof apiUsageLog.$inferInsert;
