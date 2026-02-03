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
  numeric,
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

    serperApiKeyCiphertext: bytea('serper_api_key_ciphertext'),
    serperApiKeyIv: bytea('serper_api_key_iv'),
    serperApiKeyTag: bytea('serper_api_key_tag'),
    serperKeyVersion: integer('serper_key_version').notNull().default(1),

    openaiBaseUrl: text('openai_base_url'),
    openaiEmbeddingsModel: text('openai_embeddings_model'),
    embeddingBatchSize: integer('embedding_batch_size').default(100),
    similarityThreshold: numeric('similarity_threshold', { precision: 3, scale: 2 }).default(
      '0.80'
    ),
    enabled: boolean('enabled').notNull().default(false),

    serperEnabled: boolean('serper_enabled').notNull().default(false),
    serperDailyBudget: integer('serper_daily_budget').default(1000),
    serperRateLimitPerSecond: integer('serper_rate_limit_per_second').default(10),
    serperCacheTtlSeconds: integer('serper_cache_ttl_seconds').default(86400),
    serperBudgetAlertThreshold: numeric('serper_budget_alert_threshold', {
      precision: 3,
      scale: 2,
    }).default('0.80'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [uniqueIndex('idx_shop_ai_credentials_shop').on(table.shopId)]
);

export type ShopAiCredential = typeof shopAiCredentials.$inferSelect;
export type NewShopAiCredential = typeof shopAiCredentials.$inferInsert;
