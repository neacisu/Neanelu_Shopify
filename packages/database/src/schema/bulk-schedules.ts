/**
 * Module C: Bulk Operations Schedules
 *
 * CONFORM: Plan_de_implementare F5.5.8 (Scheduling UI)
 */

import { pgTable, uuid, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { shops } from './shops.ts';

export const bulkSchedules = pgTable(
  'bulk_schedules',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    cron: text('cron').notNull(),
    timezone: text('timezone').notNull(),
    enabled: boolean('enabled').notNull().default(true),

    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [index('idx_bulk_schedules_shop').on(table.shopId)]
);

export type BulkSchedule = typeof bulkSchedules.$inferSelect;
export type NewBulkSchedule = typeof bulkSchedules.$inferInsert;
