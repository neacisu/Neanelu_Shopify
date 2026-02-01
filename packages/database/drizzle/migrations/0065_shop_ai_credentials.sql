-- Migration: 0065_shop_ai_credentials.sql
-- Purpose: Store per-shop OpenAI credentials and config (encrypted API key)

CREATE TABLE IF NOT EXISTS shop_ai_credentials (
  shop_id UUID PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  openai_api_key_ciphertext BYTEA,
  openai_api_key_iv BYTEA,
  openai_api_key_tag BYTEA,
  openai_key_version INTEGER NOT NULL DEFAULT 1,
  openai_base_url TEXT,
  openai_embeddings_model TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_ai_credentials_shop_id
  ON shop_ai_credentials (shop_id);

CREATE TRIGGER trg_shop_ai_credentials_updated_at
  BEFORE UPDATE ON shop_ai_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE shop_ai_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_ai_credentials_tenant_isolation ON shop_ai_credentials
  USING (shop_id = NULLIF(current_setting('app.current_shop_id', true), '')::uuid);
ALTER TABLE shop_ai_credentials FORCE ROW LEVEL SECURITY;
