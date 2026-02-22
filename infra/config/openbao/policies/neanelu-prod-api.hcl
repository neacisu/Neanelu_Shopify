# Neanelu PROD - API policy (KV v1)

path "secret/neanelu/prod/*" {
  capabilities = ["read", "list"]
}

path "secret/neanelu/shared/*" {
  capabilities = ["read", "list"]
}

# Dynamic PostgreSQL credentials (database secrets engine mount).
# Required by neanelu-api.env.ctmpl (DATABASE_URL + MIGRATION_DATABASE_URL).
path "neanelu-db/creds/neanelu-prod-dynamic" {
  capabilities = ["read"]
}

