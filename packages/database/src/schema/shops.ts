/**
 * Module A: System Core - shops table
 *
 * CONFORM: Database_Schema_Complete.md v2.6 - Table: shops
 *
 * Această tabelă este ROOT-ul pentru multi-tenancy.
 * Toate tabelele multi-tenant au FK la shops(id).
 *
 * Token criptat (access_token_*) folosește AES-256-GCM:
 * - ciphertext: date criptate
 * - iv: vector de inițializare (12 bytes)
 * - tag: authentication tag (16 bytes)
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
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ============================================
// Custom type pentru citext (case-insensitive)
// ============================================
// Drizzle nu are citext nativ, folosim text cu collate
// Extensia citext este activată în migrația 0000

export const shops = pgTable(
  'shops',
  {
    // Primary key cu UUIDv7 nativ PG18
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    // Domain Shopify (case-insensitive)
    shopifyDomain: text('shopify_domain').notNull().unique(),

    // Shopify numeric ID pentru API correlation
    shopifyShopId: bigint('shopify_shop_id', { mode: 'number' }).unique(),

    // Plan tier cu CHECK constraint
    planTier: varchar('plan_tier', { length: 20 }).notNull().default('basic'),

    // API version pentru Shopify calls
    apiVersion: varchar('api_version', { length: 20 }).default('2025-10'),

    // ============================================
    // Token criptat (AES-256-GCM)
    // ============================================
    // NOTĂ: Drizzle nu are tip bytea nativ, folosim text cu encoding
    // În migrația SQL vom folosi BYTEA direct
    accessTokenCiphertext: text('access_token_ciphertext').notNull(),
    accessTokenIv: text('access_token_iv').notNull(),
    accessTokenTag: text('access_token_tag').notNull(),

    // Webhook HMAC secret
    webhookSecret: text('webhook_secret'),

    // Key rotation version
    keyVersion: integer('key_version').notNull().default(1),

    // OAuth scopes granted
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    // Timezone și currency
    timezone: varchar('timezone', { length: 50 }).default('Europe/Bucharest'),
    currencyCode: varchar('currency_code', { length: 3 }).default('RON'),

    // Shop-level settings
    settings: jsonb('settings').default({}),

    // Timestamps
    installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow(),
    uninstalledAt: timestamp('uninstalled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    // Index pe domain (deja UNIQUE din coloană)
    index('idx_shops_plan').on(table.planTier),
    // Partial index pe shopify_shop_id
    index('idx_shops_shopify_id').on(table.shopifyShopId),
  ]
);

// Type inference pentru TypeScript
export type Shop = typeof shops.$inferSelect;
export type NewShop = typeof shops.$inferInsert;
