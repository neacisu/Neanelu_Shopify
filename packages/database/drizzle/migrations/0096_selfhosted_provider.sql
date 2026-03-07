ALTER TABLE shop_ai_credentials
  ADD COLUMN IF NOT EXISTS selfhosted_bearer_token_ciphertext bytea,
  ADD COLUMN IF NOT EXISTS selfhosted_bearer_token_iv bytea,
  ADD COLUMN IF NOT EXISTS selfhosted_bearer_token_tag bytea,
  ADD COLUMN IF NOT EXISTS selfhosted_key_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS selfhosted_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS selfhosted_endpoints jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS selfhosted_connection_status text DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS selfhosted_last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS selfhosted_last_error text,
  ADD COLUMN IF NOT EXISTS selfhosted_last_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS selfhosted_gpu_metrics jsonb;

COMMENT ON COLUMN shop_ai_credentials.selfhosted_endpoints
  IS 'Configured self-hosted OpenAI-compatible endpoints with exact model IDs obtained from live vLLM /v1/models audit';

COMMENT ON COLUMN shop_ai_credentials.selfhosted_connection_status
  IS 'Aggregated connection status used by provider resolver and failover logic';