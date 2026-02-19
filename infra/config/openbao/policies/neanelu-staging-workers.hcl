# Neanelu STAGING - workers policy (KV v1)

path "secret/neanelu/staging/*" {
  capabilities = ["read", "list"]
}

path "secret/neanelu/shared/*" {
  capabilities = ["read", "list"]
}

path "neanelu-db/creds/neanelu-staging-dynamic" {
  capabilities = ["read"]
}

