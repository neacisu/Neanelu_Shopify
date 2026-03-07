-- Google Gemini provider columns
ALTER TABLE shop_ai_credentials
  ADD COLUMN IF NOT EXISTS gemini_api_key_ciphertext bytea,
  ADD COLUMN IF NOT EXISTS gemini_api_key_iv bytea,
  ADD COLUMN IF NOT EXISTS gemini_api_key_tag bytea,
  ADD COLUMN IF NOT EXISTS gemini_key_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS gemini_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gemini_model text,
  ADD COLUMN IF NOT EXISTS gemini_available_models text[],
  ADD COLUMN IF NOT EXISTS gemini_temperature numeric(3,2) DEFAULT '0.10',
  ADD COLUMN IF NOT EXISTS gemini_max_tokens_per_request integer DEFAULT 4000,
  ADD COLUMN IF NOT EXISTS gemini_rate_limit_per_minute integer DEFAULT 60,
  ADD COLUMN IF NOT EXISTS gemini_daily_budget integer DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS gemini_budget_alert_threshold numeric(3,2) DEFAULT '0.80',
  ADD COLUMN IF NOT EXISTS gemini_connection_status text DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS gemini_last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS gemini_last_error text,
  ADD COLUMN IF NOT EXISTS gemini_last_success_at timestamptz;

-- DeepSeek provider columns
ALTER TABLE shop_ai_credentials
  ADD COLUMN IF NOT EXISTS deepseek_api_key_ciphertext bytea,
  ADD COLUMN IF NOT EXISTS deepseek_api_key_iv bytea,
  ADD COLUMN IF NOT EXISTS deepseek_api_key_tag bytea,
  ADD COLUMN IF NOT EXISTS deepseek_key_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deepseek_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deepseek_base_url text,
  ADD COLUMN IF NOT EXISTS deepseek_model text,
  ADD COLUMN IF NOT EXISTS deepseek_available_models text[],
  ADD COLUMN IF NOT EXISTS deepseek_temperature numeric(3,2) DEFAULT '0.10',
  ADD COLUMN IF NOT EXISTS deepseek_max_tokens_per_request integer DEFAULT 4000,
  ADD COLUMN IF NOT EXISTS deepseek_rate_limit_per_minute integer DEFAULT 60,
  ADD COLUMN IF NOT EXISTS deepseek_daily_budget integer DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS deepseek_budget_alert_threshold numeric(3,2) DEFAULT '0.80',
  ADD COLUMN IF NOT EXISTS deepseek_connection_status text DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS deepseek_last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS deepseek_last_error text,
  ADD COLUMN IF NOT EXISTS deepseek_last_success_at timestamptz;

-- AI model routing: per-task model preferences
ALTER TABLE shop_ai_credentials
  ADD COLUMN IF NOT EXISTS model_translation text DEFAULT 'openai:gpt-4o-mini',
  ADD COLUMN IF NOT EXISTS model_classification text DEFAULT 'openai:gpt-4o-mini',
  ADD COLUMN IF NOT EXISTS model_embedding text DEFAULT 'openai:text-embedding-3-large',
  ADD COLUMN IF NOT EXISTS model_extraction text DEFAULT 'xai:grok-4-1-fast-non-reasoning',
  ADD COLUMN IF NOT EXISTS model_audit text DEFAULT 'xai:grok-4-1-fast-non-reasoning';

COMMENT ON COLUMN shop_ai_credentials.model_translation IS 'Provider:model for bulk translation tasks (format: provider:model-name)';
COMMENT ON COLUMN shop_ai_credentials.model_classification IS 'Provider:model for taxonomy classification tasks';
COMMENT ON COLUMN shop_ai_credentials.model_embedding IS 'Provider:model for generating embeddings';
COMMENT ON COLUMN shop_ai_credentials.model_extraction IS 'Provider:model for structured data extraction from web pages';
COMMENT ON COLUMN shop_ai_credentials.model_audit IS 'Provider:model for AI audit tasks';
