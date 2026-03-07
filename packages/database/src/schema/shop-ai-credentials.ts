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
  jsonb,
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

    xaiApiKeyCiphertext: bytea('xai_api_key_ciphertext'),
    xaiApiKeyIv: bytea('xai_api_key_iv'),
    xaiApiKeyTag: bytea('xai_api_key_tag'),
    xaiKeyVersion: integer('xai_key_version').notNull().default(1),

    openaiBaseUrl: text('openai_base_url'),
    openaiEmbeddingsModel: text('openai_embeddings_model'),
    openaiAvailableModels: text('openai_available_models').array(),
    embeddingBatchSize: integer('embedding_batch_size').default(100),
    similarityThreshold: numeric('similarity_threshold', { precision: 3, scale: 2 }).default(
      '0.80'
    ),
    enabled: boolean('enabled').notNull().default(false),
    openaiConnectionStatus: text('openai_connection_status').default('unknown'),
    openaiLastCheckedAt: timestamp('openai_last_checked_at', { withTimezone: true }),
    openaiLastError: text('openai_last_error'),
    openaiLastSuccessAt: timestamp('openai_last_success_at', { withTimezone: true }),
    openaiDailyBudget: numeric('openai_daily_budget', { precision: 10, scale: 2 }).default('10.00'),
    openaiBudgetAlertThreshold: numeric('openai_budget_alert_threshold', {
      precision: 3,
      scale: 2,
    }).default('0.80'),
    openaiItemsDailyBudget: integer('openai_items_daily_budget').default(100000),

    serperEnabled: boolean('serper_enabled').notNull().default(false),
    serperDailyBudget: integer('serper_daily_budget').default(1000),
    serperRateLimitPerSecond: integer('serper_rate_limit_per_second').default(10),
    serperCacheTtlSeconds: integer('serper_cache_ttl_seconds').default(86400),
    serperBudgetAlertThreshold: numeric('serper_budget_alert_threshold', {
      precision: 3,
      scale: 2,
    }).default('0.80'),
    serperConnectionStatus: text('serper_connection_status').default('unknown'),
    serperLastCheckedAt: timestamp('serper_last_checked_at', { withTimezone: true }),
    serperLastError: text('serper_last_error'),
    serperLastSuccessAt: timestamp('serper_last_success_at', { withTimezone: true }),

    xaiEnabled: boolean('xai_enabled').notNull().default(false),
    xaiBaseUrl: text('xai_base_url'),
    xaiModel: text('xai_model'),
    xaiTemperature: numeric('xai_temperature', { precision: 3, scale: 2 }).default('0.10'),
    xaiMaxTokensPerRequest: integer('xai_max_tokens_per_request').default(2000),
    xaiRateLimitPerMinute: integer('xai_rate_limit_per_minute').default(60),
    xaiDailyBudget: integer('xai_daily_budget').default(1000),
    xaiBudgetAlertThreshold: numeric('xai_budget_alert_threshold', {
      precision: 3,
      scale: 2,
    }).default('0.80'),
    xaiConnectionStatus: text('xai_connection_status').default('unknown'),
    xaiLastCheckedAt: timestamp('xai_last_checked_at', { withTimezone: true }),
    xaiLastError: text('xai_last_error'),
    xaiLastSuccessAt: timestamp('xai_last_success_at', { withTimezone: true }),

    geminiApiKeyCiphertext: bytea('gemini_api_key_ciphertext'),
    geminiApiKeyIv: bytea('gemini_api_key_iv'),
    geminiApiKeyTag: bytea('gemini_api_key_tag'),
    geminiKeyVersion: integer('gemini_key_version').notNull().default(1),
    geminiEnabled: boolean('gemini_enabled').notNull().default(false),
    geminiModel: text('gemini_model'),
    geminiAvailableModels: text('gemini_available_models').array(),
    geminiTemperature: numeric('gemini_temperature', { precision: 3, scale: 2 }).default('0.10'),
    geminiMaxTokensPerRequest: integer('gemini_max_tokens_per_request').default(4000),
    geminiRateLimitPerMinute: integer('gemini_rate_limit_per_minute').default(60),
    geminiDailyBudget: integer('gemini_daily_budget').default(1000),
    geminiBudgetAlertThreshold: numeric('gemini_budget_alert_threshold', {
      precision: 3,
      scale: 2,
    }).default('0.80'),
    geminiConnectionStatus: text('gemini_connection_status').default('unknown'),
    geminiLastCheckedAt: timestamp('gemini_last_checked_at', { withTimezone: true }),
    geminiLastError: text('gemini_last_error'),
    geminiLastSuccessAt: timestamp('gemini_last_success_at', { withTimezone: true }),

    deepseekApiKeyCiphertext: bytea('deepseek_api_key_ciphertext'),
    deepseekApiKeyIv: bytea('deepseek_api_key_iv'),
    deepseekApiKeyTag: bytea('deepseek_api_key_tag'),
    deepseekKeyVersion: integer('deepseek_key_version').notNull().default(1),
    deepseekEnabled: boolean('deepseek_enabled').notNull().default(false),
    deepseekBaseUrl: text('deepseek_base_url'),
    deepseekModel: text('deepseek_model'),
    deepseekAvailableModels: text('deepseek_available_models').array(),
    deepseekTemperature: numeric('deepseek_temperature', { precision: 3, scale: 2 }).default(
      '0.10'
    ),
    deepseekMaxTokensPerRequest: integer('deepseek_max_tokens_per_request').default(4000),
    deepseekRateLimitPerMinute: integer('deepseek_rate_limit_per_minute').default(60),
    deepseekDailyBudget: integer('deepseek_daily_budget').default(1000),
    deepseekBudgetAlertThreshold: numeric('deepseek_budget_alert_threshold', {
      precision: 3,
      scale: 2,
    }).default('0.80'),
    deepseekConnectionStatus: text('deepseek_connection_status').default('unknown'),
    deepseekLastCheckedAt: timestamp('deepseek_last_checked_at', { withTimezone: true }),
    deepseekLastError: text('deepseek_last_error'),
    deepseekLastSuccessAt: timestamp('deepseek_last_success_at', { withTimezone: true }),

    selfhostedBearerTokenCiphertext: bytea('selfhosted_bearer_token_ciphertext'),
    selfhostedBearerTokenIv: bytea('selfhosted_bearer_token_iv'),
    selfhostedBearerTokenTag: bytea('selfhosted_bearer_token_tag'),
    selfhostedKeyVersion: integer('selfhosted_key_version').notNull().default(1),
    selfhostedEnabled: boolean('selfhosted_enabled').notNull().default(false),
    selfhostedEndpoints: jsonb('selfhosted_endpoints').$type<unknown[]>().notNull().default([]),
    selfhostedConnectionStatus: text('selfhosted_connection_status').default('unknown'),
    selfhostedLastCheckedAt: timestamp('selfhosted_last_checked_at', { withTimezone: true }),
    selfhostedLastError: text('selfhosted_last_error'),
    selfhostedLastSuccessAt: timestamp('selfhosted_last_success_at', { withTimezone: true }),
    selfhostedGpuMetrics: jsonb('selfhosted_gpu_metrics').$type<Record<string, unknown> | null>(),

    modelTranslation: text('model_translation').default('selfhosted:Qwen/Qwen2.5-14B-Instruct-AWQ'),
    modelClassification: text('model_classification').default(
      'selfhosted:Qwen/Qwen2.5-14B-Instruct-AWQ'
    ),
    modelEmbedding: text('model_embedding').default('selfhosted:qwen3-embedding-8b-q5km'),
    modelExtraction: text('model_extraction').default('selfhosted:Qwen/Qwen2.5-14B-Instruct-AWQ'),
    modelAudit: text('model_audit').default('selfhosted:Qwen/QwQ-32B-AWQ'),

    scraperEnabled: boolean('scraper_enabled').notNull().default(false),
    scraperRateLimitPerDomain: integer('scraper_rate_limit_per_domain').default(1),
    scraperTimeoutMs: integer('scraper_timeout_ms').default(30000),
    scraperMaxConcurrentPages: integer('scraper_max_concurrent_pages').default(5),
    scraperUserAgent: text('scraper_user_agent').default('NeaneluPIM/1.0'),
    scraperRobotsCacheTtl: integer('scraper_robots_cache_ttl').default(86400),
    scraperConnectionStatus: text('scraper_connection_status').default('unknown'),
    scraperLastCheckedAt: timestamp('scraper_last_checked_at', { withTimezone: true }),
    scraperLastError: text('scraper_last_error'),
    scraperLastSuccessAt: timestamp('scraper_last_success_at', { withTimezone: true }),

    qualityWebhookUrl: text('quality_webhook_url'),
    qualityWebhookSecret: text('quality_webhook_secret'),
    qualityWebhookEnabled: boolean('quality_webhook_enabled').notNull().default(false),
    qualityWebhookEvents: text('quality_webhook_events')
      .array()
      .notNull()
      .default(sql`'{quality_promoted,quality_demoted,review_requested,milestone_reached}'`),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [uniqueIndex('idx_shop_ai_credentials_shop').on(table.shopId)]
);

export type ShopAiCredential = typeof shopAiCredentials.$inferSelect;
export type NewShopAiCredential = typeof shopAiCredentials.$inferInsert;
