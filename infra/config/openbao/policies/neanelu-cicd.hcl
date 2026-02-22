# =============================================================================
# Neanelu Shopify - CI/CD (CT108) Policy
# =============================================================================
#
# Scop:
# - Citeste secretele necesare pentru build/deploy/migrations din OpenBao
# - Genereaza credentiale dinamice PostgreSQL (neanelu-db/creds/*)
# - Nu ofera acces de scriere pe secretele aplicatiei (KV) in mod normal
#
# Nota: folosim OpenBao KV v1 la mount-ul "secret/".

# Health checks (optional, but useful for CI diagnostics)
path "sys/health" {
  capabilities = ["read"]
}

# CI/CD needs to read environment secrets (prod/staging) to set APP_HOST, Shopify keys, etc.
path "secret/neanelu/prod/api" {
  capabilities = ["read"]
}
path "secret/neanelu/staging/api" {
  capabilities = ["read"]
}

# CI/CD runner config/secrets (e.g., GHCR pull token) - stored under secret/neanelu/ci/*
path "secret/neanelu/ci/*" {
  capabilities = ["read"]
}

# Redis ACL credentials + key patterns (prod/staging)
path "secret/neanelu/prod/redis" {
  capabilities = ["read"]
}
path "secret/neanelu/staging/redis" {
  capabilities = ["read"]
}

# PgBouncer infra secret (for diagnostics / smoke tests)
path "secret/neanelu/infra/pgbouncer" {
  capabilities = ["read"]
}

# Dynamic PostgreSQL credentials (DB secrets engine mount: neanelu-db/)
path "neanelu-db/creds/neanelu-prod-dynamic" {
  capabilities = ["read"]
}
path "neanelu-db/creds/neanelu-staging-dynamic" {
  capabilities = ["read"]
}
path "neanelu-db/creds/neanelu-dev-dynamic" {
  capabilities = ["read"]
}

