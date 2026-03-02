#!/usr/bin/env bash
set -euo pipefail

# Reconcile ownership drift for Neanelu databases on CT107.
# Scope safety:
# - touches ONLY: neanelu_shopify, neanelu_shopify_staging, neanelu_shopify_dev
# - touches ONLY schemas: public, drizzle
# - default mode: dry-run (no changes)
#
# Usage:
#   sudo bash ct107_reconcile_neanelu_ownership.sh --mode dry-run
#   sudo bash ct107_reconcile_neanelu_ownership.sh --mode apply
#
# Notes:
# - This script changes object OWNERSHIP, not data.
# - Expected target owner for application objects: neanelu_app.
# - Apply mode uses low lock timeout to avoid disrupting live traffic.

MODE="dry-run"
TARGET_OWNER="neanelu_app"
DBS=(neanelu_shopify neanelu_shopify_staging neanelu_shopify_dev)
LOCK_TIMEOUT_MS="${LOCK_TIMEOUT_MS:-2000}"
STATEMENT_TIMEOUT_MS="${STATEMENT_TIMEOUT_MS:-15000}"
STRICT="0"
HAS_DRIFT="0"
DB_FILTER=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --owner) TARGET_OWNER="${2:-}"; shift 2 ;;
    --db) DB_FILTER+=("${2:-}"); shift 2 ;;
    --strict) STRICT="1"; shift 1 ;;
    -h|--help)
      echo "Usage: $0 [--mode dry-run|apply] [--owner neanelu_app] [--db <db_name>] [--strict]"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "${MODE}" != "dry-run" && "${MODE}" != "apply" ]]; then
  echo "ERROR: --mode must be dry-run|apply" >&2
  exit 2
fi

need_bin() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing binary: $1" >&2; exit 2; }; }
need_bin sudo
need_bin psql

if ! sudo -u postgres psql -Atc "SELECT 1 FROM pg_roles WHERE rolname='${TARGET_OWNER}'" | grep -q '^1$'; then
  echo "ERROR: target owner role does not exist: ${TARGET_OWNER}" >&2
  exit 3
fi

if [[ "${#DB_FILTER[@]}" -gt 0 ]]; then
  DBS=("${DB_FILTER[@]}")
fi

echo "[ownership-reconcile] mode=${MODE} owner=${TARGET_OWNER}"

for db in "${DBS[@]}"; do
  echo "[ownership-reconcile] db=${db}"
  drift_count="$(sudo -u postgres psql -At -d "${db}" <<SQL
WITH targets AS (
  SELECT 1
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'drizzle')
    AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
    AND pg_get_userbyid(c.relowner) <> '${TARGET_OWNER}'
    AND (
      c.relkind <> 'S'
      OR NOT EXISTS (
        SELECT 1
        FROM pg_depend ds
        WHERE ds.classid = 'pg_class'::regclass
          AND ds.objid = c.oid
          AND ds.deptype = 'a'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_depend d
      WHERE d.classid = 'pg_class'::regclass
        AND d.objid = c.oid
        AND d.deptype = 'e'
    )
)
SELECT count(*) FROM targets;
SQL
)"
  if [[ "${drift_count}" != "0" ]]; then
    HAS_DRIFT="1"
  fi

  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${db}" <<SQL
WITH targets AS (
  SELECT n.nspname AS schema_name,
         c.relname AS object_name,
         c.relkind AS object_type,
         pg_get_userbyid(c.relowner) AS owner_role
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'drizzle')
    AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
    AND pg_get_userbyid(c.relowner) <> '${TARGET_OWNER}'
    AND (
      c.relkind <> 'S'
      OR NOT EXISTS (
        SELECT 1
        FROM pg_depend ds
        WHERE ds.classid = 'pg_class'::regclass
          AND ds.objid = c.oid
          AND ds.deptype = 'a'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_depend d
      WHERE d.classid = 'pg_class'::regclass
        AND d.objid = c.oid
        AND d.deptype = 'e'
    )
)
SELECT schema_name, object_name, object_type, owner_role
FROM targets
ORDER BY object_type, schema_name, object_name;
SQL

  if [[ "${MODE}" == "apply" ]]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${db}" <<SQL
DO \$\$
DECLARE
  rec RECORD;
  stmt text;
BEGIN
  PERFORM set_config('lock_timeout', '${LOCK_TIMEOUT_MS}ms', true);
  PERFORM set_config('statement_timeout', '${STATEMENT_TIMEOUT_MS}ms', true);

  FOR rec IN
    SELECT n.nspname AS schema_name,
           c.relname AS object_name,
           c.relkind AS object_type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'drizzle')
      AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
      AND pg_get_userbyid(c.relowner) <> '${TARGET_OWNER}'
      AND (
        c.relkind <> 'S'
        OR NOT EXISTS (
          SELECT 1
          FROM pg_depend ds
          WHERE ds.classid = 'pg_class'::regclass
            AND ds.objid = c.oid
            AND ds.deptype = 'a'
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass
          AND d.objid = c.oid
          AND d.deptype = 'e'
      )
    ORDER BY c.relkind, c.relname
  LOOP
    IF rec.object_type IN ('r', 'p') THEN
      stmt := format('ALTER TABLE %I.%I OWNER TO %I', rec.schema_name, rec.object_name, '${TARGET_OWNER}');
    ELSIF rec.object_type = 'S' THEN
      stmt := format('ALTER SEQUENCE %I.%I OWNER TO %I', rec.schema_name, rec.object_name, '${TARGET_OWNER}');
    ELSIF rec.object_type = 'v' THEN
      stmt := format('ALTER VIEW %I.%I OWNER TO %I', rec.schema_name, rec.object_name, '${TARGET_OWNER}');
    ELSIF rec.object_type = 'm' THEN
      stmt := format('ALTER MATERIALIZED VIEW %I.%I OWNER TO %I', rec.schema_name, rec.object_name, '${TARGET_OWNER}');
    ELSE
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE stmt;
    EXCEPTION
      WHEN lock_not_available THEN
        RAISE NOTICE '[skip-lock-timeout] %', stmt;
      WHEN query_canceled THEN
        RAISE NOTICE '[skip-statement-timeout] %', stmt;
    END;
  END LOOP;
END \$\$;
SQL
  else
    echo "[ownership-reconcile] dry-run only for db=${db}"
  fi
done

echo "[ownership-reconcile] done"
if [[ "${STRICT}" == "1" && "${HAS_DRIFT}" == "1" ]]; then
  echo "[ownership-reconcile] strict mode failed: ownership drift detected" >&2
  exit 4
fi
