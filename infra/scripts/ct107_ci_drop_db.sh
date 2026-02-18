#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# CT107 - Neanelu CI drop DB(s)
# =============================================================================
# Scop:
# - sterge clone temporare create de ct107_ci_clone_db.sh
# - ruleaza ca `postgres` (de obicei prin `sudo -u postgres`)
#
# Exemple:
#   sudo -u postgres bash /opt/neanelu/infra/scripts/ct107_ci_drop_db.sh --env staging --run-id 123-1-deadbee
#   sudo -u postgres bash /opt/neanelu/infra/scripts/ct107_ci_drop_db.sh --target-db neanelu_shopify_prod_ci_xxx --force 1
# =============================================================================

ENVIRONMENT=""
RUN_ID=""
TARGET_DB=""
FORCE="1"

usage() {
  echo "Usage: $0 [--env dev|staging|prod --run-id <id> | --target-db <db>] [--force 1]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENVIRONMENT="${2:-}"; shift 2 ;;
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --target-db) TARGET_DB="${2:-}"; shift 2 ;;
    --force) FORCE="${2:-1}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

need_bin() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing bin=$1" >&2; exit 2; }; }
need_bin psql
need_bin dropdb
need_bin python3
need_bin flock

ts="$(date -u +%Y%m%dT%H%M%SZ)"
LOCK_FILE="/var/lock/neanelu_ci_db.lock"

if [[ -z "${TARGET_DB}" && -n "${ENVIRONMENT}" && -n "${RUN_ID}" ]]; then
  TARGET_DB="$(python3 - "${ENVIRONMENT}" "${RUN_ID}" <<'PY'
import hashlib, re, sys
env=sys.argv[1]
run_id=sys.argv[2]
clean=re.sub(r"[^a-zA-Z0-9_]+","_",run_id).strip("_")
clean=re.sub(r"_+","_",clean)
h=hashlib.sha1(run_id.encode("utf-8")).hexdigest()[:8]
clean=(clean[:24] if len(clean)>24 else clean)
suffix=f"{clean}_{h}" if clean else f"run_{h}"
if env=="dev":
  print(f"neanelu_shopify_dev_ci_{suffix}")
elif env=="staging":
  print(f"neanelu_shopify_staging_ci_{suffix}")
else:
  print(f"neanelu_shopify_prod_ci_{suffix}")
PY
)"
fi

drop_one() {
  local db="$1"
  if [[ -z "$db" ]]; then return 0; fi
  echo "drop_db ts=${ts} db=${db} force=${FORCE}"
  if [[ "${FORCE}" == "1" ]]; then
    dropdb --if-exists --force "${db}" || true
  else
    dropdb --if-exists "${db}" || true
  fi
}

exec 9>"${LOCK_FILE}"
flock 9

if [[ -z "${TARGET_DB}" ]]; then
  echo "ERROR: missing --target-db OR (--env + --run-id)" >&2
  exit 2
fi

drop_one "${TARGET_DB}"
echo "ct107_ci_drop_db done"

