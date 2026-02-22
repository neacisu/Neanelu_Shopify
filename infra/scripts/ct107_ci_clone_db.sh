#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# CT107 - Neanelu CI clone DB
# =============================================================================
# Scop:
# - ruleaza pe CT107 (postgres-main) si creeaza clone temporare pentru CI.
# - ruleaza ca `postgres` (de obicei prin `sudo -u postgres`).
#
# Design:
# - locking per-environment (flock) permite clone-uri paralele pentru env-uri diferite.
# - default: incearca TEMPLATE (rapid), fallback: pg_dump/pg_restore (robust).
# - template clone: retry loop cu pg_terminate_backend + verify 0 connections.
# - evita parametri presupusi: env->source db mapping este explicita aici.
#
# Exemple:
#   sudo -u postgres bash /opt/neanelu/infra/scripts/ct107_ci_clone_db.sh --env staging --run-id 123-1-deadbee
#   sudo -u postgres bash /opt/neanelu/infra/scripts/ct107_ci_clone_db.sh --env prod --run-id 123-1-deadbee --strategy dump
# =============================================================================

ENVIRONMENT=""
RUN_ID=""
STRATEGY="template"   # template|dump
FALLBACK="dump"       # template->dump
FORCE="0"
JOBS="4"

usage() {
  echo "Usage: $0 --env dev|staging|prod --run-id <id> [--strategy template|dump] [--fallback dump|none] [--jobs N] [--force 1]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENVIRONMENT="${2:-}"; shift 2 ;;
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --strategy) STRATEGY="${2:-}"; shift 2 ;;
    --fallback) FALLBACK="${2:-}"; shift 2 ;;
    --jobs) JOBS="${2:-}"; shift 2 ;;
    --force) FORCE="${2:-1}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "${ENVIRONMENT}" || -z "${RUN_ID}" ]]; then
  usage
  exit 2
fi

if [[ -z "${JOBS}" || ! "${JOBS}" =~ ^[0-9]+$ || "${JOBS}" -lt 1 ]]; then
  echo "ERROR: invalid --jobs=${JOBS} (expected positive integer)" >&2
  exit 2
fi

case "${ENVIRONMENT}" in
  dev) SOURCE_DB="neanelu_shopify_dev" ;;
  staging) SOURCE_DB="neanelu_shopify_staging" ;;
  prod|production) SOURCE_DB="neanelu_shopify" ;;
  *) echo "ERROR: invalid --env=${ENVIRONMENT}" >&2; exit 2 ;;
esac

need_bin() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing bin=$1" >&2; exit 2; }; }
need_bin psql
need_bin createdb
need_bin dropdb
need_bin pg_dump
need_bin pg_restore
need_bin python3
need_bin flock

ts="$(date -u +%Y%m%dT%H%M%SZ)"

# Sanitize run id for Postgres identifier length constraints.
sanitized="$(RUN_ID="${RUN_ID}" python3 - <<'PY'
import hashlib, os, re
s=os.environ["RUN_ID"]
clean=re.sub(r"[^a-zA-Z0-9_]+","_",s).strip("_")
clean=re.sub(r"_+","_",clean)
h=hashlib.sha1(s.encode("utf-8")).hexdigest()[:8]
clean=(clean[:24] if len(clean)>24 else clean)
print(f"{clean}_{h}" if clean else f"run_{h}")
PY
)"

case "${ENVIRONMENT}" in
  dev) TARGET_DB="neanelu_shopify_dev_ci_${sanitized}" ;;
  staging) TARGET_DB="neanelu_shopify_staging_ci_${sanitized}" ;;
  prod|production) TARGET_DB="neanelu_shopify_prod_ci_${sanitized}" ;;
esac

LOCK_FILE="/var/lock/neanelu_ci_db_${ENVIRONMENT}.lock"

echo "ct107_ci_clone_db start ts=${ts} env=${ENVIRONMENT} source=${SOURCE_DB} target=${TARGET_DB} strategy=${STRATEGY} force=${FORCE} jobs=${JOBS}"

flock "${LOCK_FILE}" bash -lc "
set -euo pipefail

exists_db() {
  psql -Atc \"select 1 from pg_database where datname='\$1'\" | grep -q '^1\$'
}

if ! exists_db \"${SOURCE_DB}\"; then
  echo \"ERROR: source_db_missing=${SOURCE_DB}\" >&2
  exit 3
fi

if exists_db \"${TARGET_DB}\"; then
  if [[ \"${FORCE}\" == \"1\" ]]; then
    echo \"target_exists -> drop (force=1)\"
    # FORCE is supported on Postgres 13+. If unsupported, dropdb will fail and we stop.
    dropdb --if-exists --force \"${TARGET_DB}\"
  else
    echo \"ERROR: target_db_exists=${TARGET_DB} (use --force 1 or drop script)\" >&2
    exit 4
  fi
fi

clone_template() {
  echo \"clone_template source=${SOURCE_DB} target=${TARGET_DB}\"
  psql -d postgres -c \"ALTER DATABASE \\\"${SOURCE_DB}\\\" ALLOW_CONNECTIONS false;\" || true

  local max_retries=5
  local remaining=999
  for attempt in \$(seq 1 \$max_retries); do
    psql -d postgres -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${SOURCE_DB}' AND pid <> pg_backend_pid();\" || true
    sleep 1
    remaining=\$(psql -Atc \"SELECT count(*) FROM pg_stat_activity WHERE datname='${SOURCE_DB}' AND pid <> pg_backend_pid();\")
    if [[ \"\${remaining}\" == \"0\" ]]; then
      break
    fi
    echo \"terminate_retry attempt=\${attempt} remaining=\${remaining}\"
  done

  if [[ \"\${remaining}\" != \"0\" ]]; then
    echo \"WARN: still \${remaining} sessions after \${max_retries} retries\" >&2
    psql -d postgres -c \"ALTER DATABASE \\\"${SOURCE_DB}\\\" ALLOW_CONNECTIONS true;\" || true
    return 1
  fi

  if psql -v ON_ERROR_STOP=1 -d postgres -c \"CREATE DATABASE \\\"${TARGET_DB}\\\" TEMPLATE \\\"${SOURCE_DB}\\\" OWNER neanelu_app;\"; then
    psql -d postgres -c \"ALTER DATABASE \\\"${SOURCE_DB}\\\" ALLOW_CONNECTIONS true;\" || true
    return 0
  else
    psql -d postgres -c \"ALTER DATABASE \\\"${SOURCE_DB}\\\" ALLOW_CONNECTIONS true;\" || true
    return 1
  fi
}

clone_dump() {
  echo \"clone_dump source=${SOURCE_DB} target=${TARGET_DB}\"
  createdb -O neanelu_app \"${TARGET_DB}\"
  # Directory format enables parallel dump/restore (much faster than -Fc on big DBs).
  tmpdir=\"/tmp/${TARGET_DB}.dumpdir\"
  rm -rf \"\$tmpdir\" || true
  mkdir -p \"\$tmpdir\"
  pg_dump -Fd -j \"${JOBS}\" --no-owner --no-acl -d \"${SOURCE_DB}\" -f \"\$tmpdir\"
  pg_restore -Fd -j \"${JOBS}\" --no-owner --no-acl -d \"${TARGET_DB}\" \"\$tmpdir\"
  rm -rf \"\$tmpdir\" || true
}

if [[ \"${STRATEGY}\" == \"template\" ]]; then
  if clone_template; then
    echo \"clone_ok strategy=template\"
  else
    if [[ \"${FALLBACK}\" == \"dump\" ]]; then
      echo \"clone_template_failed -> fallback=dump\" >&2
      clone_dump
      echo \"clone_ok strategy=dump\"
    else
      echo \"ERROR: clone_template_failed and fallback=none\" >&2
      exit 5
    fi
  fi
elif [[ \"${STRATEGY}\" == \"dump\" ]]; then
  clone_dump
  echo \"clone_ok strategy=dump\"
else
  echo \"ERROR: invalid strategy=${STRATEGY}\" >&2
  exit 2
fi

# Tag DB for later garbage collection / audit.
psql -v ON_ERROR_STOP=1 -d postgres -c \"COMMENT ON DATABASE \\\"${TARGET_DB}\\\" IS 'neanelu_ci created_at=${ts} env=${ENVIRONMENT} run_id=${RUN_ID} source_db=${SOURCE_DB}';\"

echo \"ct107_ci_clone_db done target_db=${TARGET_DB}\"
"

