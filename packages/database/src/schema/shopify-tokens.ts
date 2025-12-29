/**
 * Shopify Tokens - encrypted OAuth tokens per shop
 *
 * Coloane cheie:
 * - access_token_*: AES-256-GCM (ciphertext, iv 12 bytes, tag 16 bytes)
 * - key_version: versiunea cheii active (pentru rotație backward-compatible)
 *
 * RLS: multi-tenant pe shop_id (politica se adaugă prin migrație)
 */

import {
  pgTable,
  uuid,
  integer,
  text,
  timestamp,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { shops } from './shops.ts';

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
  fromDriver(value) {
    return value as Buffer;
  },
  toDriver(value) {
    return value;
  },
});

export const shopifyTokens = pgTable(
  'shopify_tokens',
  {
    id: uuid('id')
      .$type<string>()
      .primaryKey()
      .default(sql`uuidv7()`),

    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),

    accessTokenCiphertext: bytea('access_token_ciphertext').notNull(),
    accessTokenIv: bytea('access_token_iv').notNull(), // 12 bytes
    accessTokenTag: bytea('access_token_tag').notNull(), // 16 bytes

    keyVersion: integer('key_version').notNull().default(1),

    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('idx_shopify_tokens_shop').on(table.shopId),
    uniqueIndex('idx_shopify_tokens_shop_key').on(table.shopId, table.keyVersion),
  ]
);

export type ShopifyToken = typeof shopifyTokens.$inferSelect;
export type NewShopifyToken = typeof shopifyTokens.$inferInsert;
