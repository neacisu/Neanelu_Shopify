#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# CT107 - Garbage collect orphaned Neanelu CI databases
# =============================================================================
# Scop:
# - sterge DB-uri CI (pattern *_ci_*) mai vechi decat o limita, pe baza comment-ului
#   setat de ct107_ci_clone_db.sh (created_at=YYYYmmddTHHMMSSZ).
# - ruleaza ca `postgres` (de obicei prin `sudo -u postgres`)
#
# Exemplu:
#   sudo -u postgres bash /opt/neanelu/infra/scripts/ct107_ci_gc_dbs.sh --older-than-hours 24
# =============================================================================

OLDER_HOURS="${OLDER_HOURS:-}"

usage() { echo "Usage: $0 --older-than-hours <n>" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --older-than-hours) OLDER_HOURS="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "${OLDER_HOURS}" ]]; then
  usage
  exit 2
fi

need_bin() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing bin=$1" >&2; exit 2; }; }
need_bin psql
need_bin dropdb
need_bin python3
need_bin flock

LOCK_FILE="/var/lock/neanelu_ci_db.lock"
now="$(date -u +%Y%m%dT%H%M%SZ)"

flock "${LOCK_FILE}" bash -lc "
set -euo pipefail

echo \"ct107_ci_gc start now=${now} older_than_hours=${OLDER_HOURS}\"

psql -At -v ON_ERROR_STOP=1 <<'SQL' | python3 - \"${now}\" \"${OLDER_HOURS}\"
select
  datname
  || E'\t' ||
  coalesce(pg_catalog.shobj_description(oid, 'pg_database'), '')
from pg_database
where datname ~ '^neanelu_shopify_(dev|staging|prod)_ci_';
SQL
import sys, datetime, re, subprocess
now_s=sys.argv[1]; hours=int(sys.argv[2])
now=datetime.datetime.strptime(now_s, \"%Y%m%dT%H%M%SZ\").replace(tzinfo=datetime.timezone.utc)
cutoff=now - datetime.timedelta(hours=hours)
to_drop=[]
for raw in sys.stdin.read().splitlines():
    if not raw.strip():\n        continue
    name, _, comment = raw.partition('\\t')
    m=re.search(r'created_at=([0-9]{8}T[0-9]{6}Z)', comment)\n
    if not m:\n        continue\n
    created=datetime.datetime.strptime(m.group(1), \"%Y%m%dT%H%M%SZ\").replace(tzinfo=datetime.timezone.utc)
    if created <= cutoff:\n        to_drop.append((name, created))
for name, created in sorted(to_drop, key=lambda x: x[1]):\n    print(f\"drop_orphan db={name} created_at={created.isoformat()}\")\n    subprocess.run([\"dropdb\",\"--if-exists\",\"--force\",name], check=False)\nprint(f\"gc_done dropped={len(to_drop)}\")\n\n\""

