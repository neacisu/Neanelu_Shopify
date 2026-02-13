import {
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { prodSources } from './pim.js';
import { shops } from './shops.js';

export const scraperConfigs = pgTable(
  'scraper_configs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => prodSources.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    scraperType: varchar('scraper_type', { length: 50 }).notNull(),
    targetUrlPattern: text('target_url_pattern').notNull(),
    selectors: jsonb('selectors').notNull(),
    paginationConfig: jsonb('pagination_config'),
    rateLimit: jsonb('rate_limit'),
    retryConfig: jsonb('retry_config'),
    headers: jsonb('headers').default({}),
    cookies: jsonb('cookies').default({}),
    proxyConfig: jsonb('proxy_config'),
    isActive: boolean('is_active').default(true),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    successRate: decimal('success_rate', { precision: 5, scale: 2 }),
    maxConcurrentPages: integer('max_concurrent_pages').default(5),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_scraper_configs_source').on(table.sourceId),
    index('idx_scraper_configs_shop').on(table.shopId, table.isActive, table.updatedAt),
    index('idx_scraper_configs_active').on(table.isActive, table.scraperType),
  ]
);

export const scraperRuns = pgTable(
  'scraper_runs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    configId: uuid('config_id')
      .notNull()
      .references(() => scraperConfigs.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => prodSources.id),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    triggerType: varchar('trigger_type', { length: 30 }),
    targetUrls: text('target_urls').array(),
    pagesCrawled: integer('pages_crawled').default(0),
    productsFound: integer('products_found').default(0),
    productsUpdated: integer('products_updated').default(0),
    errorsCount: integer('errors_count').default(0),
    errorLog: jsonb('error_log').default([]),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    memoryPeakMb: integer('memory_peak_mb'),
    contentHashesDeduped: integer('content_hashes_deduped').default(0),
    method: varchar('method', { length: 20 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_scraper_runs_config').on(table.configId, table.createdAt),
    index('idx_scraper_runs_shop').on(table.shopId, table.createdAt),
    index('idx_scraper_runs_status').on(table.status, table.createdAt),
    index('idx_scraper_runs_source').on(table.sourceId, table.createdAt),
  ]
);

export const scraperQueue = pgTable(
  'scraper_queue',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    configId: uuid('config_id')
      .notNull()
      .references(() => scraperConfigs.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    priority: integer('priority').default(0),
    depth: integer('depth').default(0),
    parentUrl: text('parent_url'),
    status: varchar('status', { length: 20 }).default('pending'),
    attempts: integer('attempts').default(0),
    maxAttempts: integer('max_attempts').default(3),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_scraper_queue_pending').on(table.configId, table.priority, table.createdAt),
    index('idx_scraper_queue_shop').on(table.shopId, table.status, table.nextAttemptAt),
    index('idx_scraper_queue_url').on(table.url),
    index('idx_scraper_queue_next').on(table.nextAttemptAt),
  ]
);

export type ScraperConfig = typeof scraperConfigs.$inferSelect;
export type NewScraperConfig = typeof scraperConfigs.$inferInsert;
export type ScraperRun = typeof scraperRuns.$inferSelect;
export type NewScraperRun = typeof scraperRuns.$inferInsert;
export type ScraperQueueItem = typeof scraperQueue.$inferSelect;
export type NewScraperQueueItem = typeof scraperQueue.$inferInsert;
