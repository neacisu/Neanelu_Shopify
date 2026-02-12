import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { shops } from './shops.ts';

export const pimNotifications = pgTable(
  'pim_notifications',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(),
    title: text('title').notNull(),
    body: jsonb('body').notNull(),
    read: boolean('read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [index('idx_pim_notifications_shop').on(table.shopId, table.createdAt)]
);

export type PimNotification = typeof pimNotifications.$inferSelect;
export type NewPimNotification = typeof pimNotifications.$inferInsert;
