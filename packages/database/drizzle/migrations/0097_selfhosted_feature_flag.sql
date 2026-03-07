INSERT INTO feature_flags (
  flag_key,
  description,
  default_value,
  is_active,
  rollout_percentage,
  allowed_shop_ids,
  blocked_shop_ids
)
VALUES (
  'selfhosted_llm_enabled',
  'Enable self-hosted LLM routing for explicitly allowed shops while infrastructure rollout is in progress',
  false,
  true,
  0,
  '{}'::uuid[],
  '{}'::uuid[]
)
ON CONFLICT (flag_key)
DO UPDATE SET
  description = EXCLUDED.description,
  default_value = EXCLUDED.default_value,
  is_active = EXCLUDED.is_active,
  rollout_percentage = EXCLUDED.rollout_percentage,
  updated_at = now();