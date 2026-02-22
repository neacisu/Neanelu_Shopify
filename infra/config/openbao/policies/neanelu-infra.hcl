# Neanelu INFRA policy (KV v1)
#
# Used by infra-side agents/sidecars (ex: OpenBao Agent templates, PgBouncer templates).

path "secret/neanelu/infra/*" {
  capabilities = ["read", "list"]
}

path "secret/neanelu/shared/*" {
  capabilities = ["read", "list"]
}

path "secret/neanelu/prod/*" {
  capabilities = ["read", "list"]
}

path "secret/neanelu/staging/*" {
  capabilities = ["read", "list"]
}

# Dynamic PostgreSQL credentials (database secrets engine mount).
path "neanelu-db/creds/*" {
  capabilities = ["read"]
}