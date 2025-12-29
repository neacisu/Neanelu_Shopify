/**
 * Module A: System Core - staff_users & app_sessions tables
 *
 * CONFORM: Database_Schema_Complete.md v2.6
 *
 * staff_users: Staff accounts per shop
 * app_sessions: Session storage for authentication
 *
 * Ambele tabele au RLS cu shop_id isolation.
 */

import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { shops } from './shops.ts';

// ============================================
// Table: staff_users
// ============================================
export const staffUsers = pgTable(
  'staff_users',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    // Email case-insensitive (citext via extension)
    email: text('email').notNull(),

    firstName: varchar('first_name', { length: 100 }),
    lastName: varchar('last_name', { length: 100 }),

    // Role permissions as JSONB
    role: jsonb('role').default({ admin: false }),

    // Locale preference
    locale: varchar('locale', { length: 10 }).default('en'),

    // Last login tracking
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    // UNIQUE per shop + email
    uniqueIndex('idx_staff_shop_email').on(table.shopId, table.email),
  ]
);

export type StaffUser = typeof staffUsers.$inferSelect;
export type NewStaffUser = typeof staffUsers.$inferInsert;

// ============================================
// Table: app_sessions
// ============================================
export const appSessions = pgTable(
  'app_sessions',
  {
    // Session ID is VARCHAR PK (not UUID)
    id: varchar('id', { length: 255 }).primaryKey(),

    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    // Session payload
    payload: jsonb('payload').notNull(),

    // Expiration time
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_sessions_shop').on(table.shopId),
    index('idx_sessions_expires').on(table.expiresAt),
  ]
);

export type AppSession = typeof appSessions.$inferSelect;
export type NewAppSession = typeof appSessions.$inferInsert;
