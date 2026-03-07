UPDATE feature_flags
SET default_value = true,
    rollout_percentage = 100,
    is_active = true,
    updated_at = now()
WHERE flag_key = 'selfhosted_llm_enabled';

ALTER TABLE shop_ai_credentials
  ALTER COLUMN model_translation SET DEFAULT 'selfhosted:Qwen/Qwen2.5-14B-Instruct-AWQ',
  ALTER COLUMN model_classification SET DEFAULT 'selfhosted:Qwen/Qwen2.5-14B-Instruct-AWQ',
  ALTER COLUMN model_embedding SET DEFAULT 'selfhosted:qwen3-embedding-8b-q5km',
  ALTER COLUMN model_extraction SET DEFAULT 'selfhosted:Qwen/Qwen2.5-14B-Instruct-AWQ',
  ALTER COLUMN model_audit SET DEFAULT 'selfhosted:Qwen/QwQ-32B-AWQ';

DO $$
DECLARE
  v_shop_id uuid;
BEGIN
  FOR v_shop_id IN SELECT id FROM shops LOOP
    PERFORM set_config('app.current_shop_id', v_shop_id::text, false);
    INSERT INTO shop_ai_credentials (
      shop_id,
      selfhosted_enabled,
      selfhosted_endpoints,
      model_translation,
      model_classification,
      model_embedding,
      model_extraction,
      model_audit
    )
    VALUES (
      v_shop_id,
      true,
      jsonb_build_array(
        jsonb_build_object(
          'id', 'selfhosted-chat-fast',
          'label', 'Qwen 14B Self-hosted',
          'baseUrl', 'http://10.0.1.10:49002/v1',
          'modelId', 'Qwen/Qwen2.5-14B-Instruct-AWQ',
          'type', 'chat',
          'enabled', true,
          'maxConcurrentRequests', 8,
          'timeoutMs', 30000
        ),
        jsonb_build_object(
          'id', 'selfhosted-chat-reasoning',
          'label', 'QwQ 32B Self-hosted',
          'baseUrl', 'http://10.0.1.10:49001/v1',
          'modelId', 'Qwen/QwQ-32B-AWQ',
          'type', 'chat',
          'enabled', true,
          'maxConcurrentRequests', 4,
          'timeoutMs', 45000
        ),
        jsonb_build_object(
          'id', 'selfhosted-embedding',
          'label', 'Qwen3 Embedding Self-hosted',
          'baseUrl', 'http://10.0.1.10:49003/v1',
          'modelId', 'qwen3-embedding-8b-q5km',
          'type', 'embedding',
          'enabled', true,
          'maxConcurrentRequests', 16,
          'timeoutMs', 30000
        )
      ),
      'selfhosted:Qwen/Qwen2.5-14B-Instruct-AWQ',
      'selfhosted:Qwen/Qwen2.5-14B-Instruct-AWQ',
      'selfhosted:qwen3-embedding-8b-q5km',
      'selfhosted:Qwen/Qwen2.5-14B-Instruct-AWQ',
      'selfhosted:Qwen/QwQ-32B-AWQ'
    )
    ON CONFLICT (shop_id) DO UPDATE SET
      selfhosted_enabled = true,
      selfhosted_endpoints = EXCLUDED.selfhosted_endpoints,
      model_translation = EXCLUDED.model_translation,
      model_classification = EXCLUDED.model_classification,
      model_embedding = EXCLUDED.model_embedding,
      model_extraction = EXCLUDED.model_extraction,
      model_audit = EXCLUDED.model_audit,
      updated_at = now()
    WHERE shop_ai_credentials.selfhosted_enabled IS DISTINCT FROM true
      OR shop_ai_credentials.selfhosted_endpoints IS NULL
      OR shop_ai_credentials.selfhosted_endpoints = '[]'::jsonb;
  END LOOP;
END $$;
