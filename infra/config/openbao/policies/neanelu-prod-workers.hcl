# Neanelu PROD - workers policy (KV v1)

path "secret/neanelu/prod/*" {
  capabilities = ["read", "list"]
}

path "secret/neanelu/shared/*" {
  capabilities = ["read", "list"]
}

# Dynamic PostgreSQL credentials (database secrets engine mount).
path "neanelu-db/creds/neanelu-prod-dynamic" {
  capabilities = ["read"]
}

