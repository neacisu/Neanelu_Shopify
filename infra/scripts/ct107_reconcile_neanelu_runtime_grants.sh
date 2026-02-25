#!/usr/bin/env bash
set -euo pipefail

# Reconcile stable runtime RBAC for all Neanelu databases (dev/staging/prod).
# Run on CT107 (postgres-main) as root:
#   sudo bash ct107_reconcile_neanelu_runtime_grants.sh
#
# Scope safety:
# - touches only roles: neanelu_runtime, neanelu_app, neanelu_vault
# - touches only DBs: neanelu_shopify, neanelu_shopify_staging, neanelu_shopify_dev

need_bin() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing binary: $1" >&2; exit 2; }; }
need_bin sudo
need_bin psql

DBS=(neanelu_shopify neanelu_shopify_staging neanelu_shopify_dev)

echo "[reconcile] ensure roles"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neanelu_runtime') THEN
    CREATE ROLE neanelu_runtime NOLOGIN;
  END IF;
END $$;

ALTER ROLE neanelu_vault CREATEROLE;
GRANT neanelu_runtime TO neanelu_vault WITH ADMIN OPTION;
GRANT neanelu_app TO neanelu_vault WITH ADMIN OPTION;
GRANT neanelu_runtime TO neanelu_app;
SQL

for db in "${DBS[@]}"; do
  echo "[reconcile] db=${db}"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${db}" <<'SQL'
GRANT ALL ON SCHEMA public TO neanelu_runtime;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO neanelu_runtime;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO neanelu_runtime;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO neanelu_runtime;

-- Keep backward compatibility for legacy paths still bound to neanelu_app.
GRANT ALL ON SCHEMA public TO neanelu_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO neanelu_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO neanelu_app;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO neanelu_app;

-- Future objects created by postgres in public inherit grants for both stable roles.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO neanelu_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO neanelu_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO neanelu_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO neanelu_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO neanelu_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO neanelu_app;
SQL
done

echo "[reconcile] complete"
