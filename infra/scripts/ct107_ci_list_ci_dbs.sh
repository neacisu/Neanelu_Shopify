#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# CT107 - List Neanelu CI databases
# =============================================================================
# Scop:
# - listeaza DB-urile create pentru CI (pattern *_ci_*) si comment-ul lor (daca exista)
# - ruleaza ca `postgres` (de obicei prin `sudo -u postgres`)
#
# Exemplu:
#   sudo -u postgres bash /opt/neanelu/infra/scripts/ct107_ci_list_ci_dbs.sh
# =============================================================================

need_bin() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing bin=$1" >&2; exit 2; }; }
need_bin psql

psql -v ON_ERROR_STOP=1 -At <<'SQL'
select
  datname
  || E'\t' ||
  coalesce(pg_catalog.shobj_description(oid, 'pg_database'), '')
from pg_database
where datname ~ '^neanelu_shopify_(dev|staging|prod)_ci_'
order by datname;
SQL

