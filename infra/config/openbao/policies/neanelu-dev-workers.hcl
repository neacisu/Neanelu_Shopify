# Neanelu DEV - workers policy (KV v1)

path "secret/neanelu/dev/*" {
  capabilities = ["read", "list"]
}

path "secret/neanelu/shared/*" {
  capabilities = ["read", "list"]
}

path "neanelu-db/creds/neanelu-dev-dynamic" {
  capabilities = ["read"]
}

