import { index, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { prodQualityEvents } from './pim.ts';
import { shops } from './shops.ts';

export const qualityWebhookDeliveries = pgTable(
  'quality_webhook_deliveries',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    eventId: uuid('event_id')
      .notNull()
      .references(() => prodQualityEvents.id, { onDelete: 'cascade' }),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    eventType: varchar('event_type', { length: 50 }),
    httpStatus: integer('http_status'),
    durationMs: integer('duration_ms'),
    responseBody: text('response_body'),
    attempt: integer('attempt').notNull().default(1),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_qwd_event').on(table.eventId),
    index('idx_qwd_shop_created').on(table.shopId, table.createdAt),
  ]
);

export type QualityWebhookDelivery = typeof qualityWebhookDeliveries.$inferSelect;
export type NewQualityWebhookDelivery = typeof qualityWebhookDeliveries.$inferInsert;
