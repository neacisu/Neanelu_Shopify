ALTER TABLE shop_ai_credentials
  ADD COLUMN openai_connection_status text DEFAULT 'unknown',
  ADD COLUMN openai_last_checked_at timestamptz,
  ADD COLUMN openai_last_success_at timestamptz,
  ADD COLUMN openai_last_error text;
