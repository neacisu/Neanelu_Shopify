/**
 * Module A: System Core - shop_ai_credentials table
 *
 * Stores per-shop OpenAI credentials (encrypted) and configuration.
 */

import {
  pgTable,
  uuid,
  integer,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';
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

export const shopAiCredentials = pgTable(
  'shop_ai_credentials',
  {
    shopId: uuid('shop_id')
      .primaryKey()
      .references(() => shops.id, { onDelete: 'cascade' }),

    openaiApiKeyCiphertext: bytea('openai_api_key_ciphertext'),
    openaiApiKeyIv: bytea('openai_api_key_iv'),
    openaiApiKeyTag: bytea('openai_api_key_tag'),
    openaiKeyVersion: integer('openai_key_version').notNull().default(1),

    openaiBaseUrl: text('openai_base_url'),
    openaiEmbeddingsModel: text('openai_embeddings_model'),
    enabled: boolean('enabled').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [uniqueIndex('idx_shop_ai_credentials_shop').on(table.shopId)]
);

export type ShopAiCredential = typeof shopAiCredentials.$inferSelect;
export type NewShopAiCredential = typeof shopAiCredentials.$inferInsert;
