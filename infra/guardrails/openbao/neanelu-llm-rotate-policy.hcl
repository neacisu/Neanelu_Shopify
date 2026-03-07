# Neanelu LLM Key Rotation policy (KV v2)
path "kv-llm/data/webui" {
  capabilities = ["create", "update", "read"]
}

path "kv-llm/data/guardrails" {
  capabilities = ["create", "update", "read"]
}
