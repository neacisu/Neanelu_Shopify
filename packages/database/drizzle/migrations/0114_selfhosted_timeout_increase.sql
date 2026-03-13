-- Increase selfhosted LLM endpoint timeouts.
-- selfhosted-chat-fast: 30s → 90s (Qwen2.5-14B-Instruct-AWQ needs >30s for description generation)
-- selfhosted-chat-reasoning: 45s → 120s (QwQ-32B-AWQ needs >45s for complex prompts)
-- Root cause: all 4 consensus participants + singleCallFallback timed out during description generation.

UPDATE shop_ai_credentials
SET selfhosted_endpoints = (
  SELECT jsonb_agg(
    CASE
      WHEN elem->>'id' = 'selfhosted-chat-fast'
        THEN jsonb_set(elem, '{timeoutMs}', '90000'::jsonb)
      WHEN elem->>'id' = 'selfhosted-chat-reasoning'
        THEN jsonb_set(elem, '{timeoutMs}', '120000'::jsonb)
      ELSE elem
    END
  )
  FROM jsonb_array_elements(selfhosted_endpoints) AS elem
)
WHERE selfhosted_endpoints IS NOT NULL
  AND selfhosted_endpoints != '[]'::jsonb;
