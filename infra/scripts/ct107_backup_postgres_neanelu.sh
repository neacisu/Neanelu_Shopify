#!/usr/bin/env bash
set -euo pipefail

# CT107 (postgres-main) backup helper for Neanelu.
#
# Rule: no secrets in repo. This script is intended to be executed on CT107.
# It uses local superuser access via `sudo -u postgres` and writes dumps to disk.
#
# Optional: upload to Hetzner Storage Box via SSH/SFTP-compatible endpoint
# using env vars (see below).
#
# Usage examples (on CT107):
#   sudo bash infra/scripts/ct107_backup_postgres_neanelu.sh
#   DRY_RUN=1 sudo bash infra/scripts/ct107_backup_postgres_neanelu.sh
#
# Env vars:
#   BACKUP_ROOT   (default: /var/backups/neanelu/postgres)
#   DBS           (default: "neanelu_shopify neanelu_shopify_staging")
#   RETENTION_DAYS (default: 14) - deletes backups older than this (local only)
#
# Storage Box (optional):
#   STORAGEBOX_HOST
#   STORAGEBOX_USER
#   STORAGEBOX_PATH  (e.g. backups/neanelu/postgres)
#   STORAGEBOX_SSH_KEY (absolute path on CT107; optional if ssh-agent)
#   STORAGEBOX_PORT (default: 23)  # Hetzner Storage Box SSH port often 23
#
# Note:
# - The actual DB creation for Neanelu happens in phase00-004.
# - You can still keep this script ready now; once DBs exist it will work.

BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/neanelu/postgres}"
DBS="${DBS:-neanelu_shopify neanelu_shopify_staging}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DRY_RUN="${DRY_RUN:-0}"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
run_id="ct107_neanelu_${ts}"
out_dir="${BACKUP_ROOT}/${run_id}"

umask 077

need_bin() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: missing binary: $1" >&2
    exit 2
  }
}

need_bin sudo
need_bin sha256sum
need_bin find
need_bin gzip
need_bin psql
need_bin pg_dump
need_bin pg_restore

echo "Backup root: ${BACKUP_ROOT}"
echo "Run dir:     ${out_dir}"
echo "Databases:   ${DBS}"

if [[ "${DRY_RUN}" == "1" ]]; then
  echo "DRY_RUN=1 (no writes, no dumps)"
  sudo -u postgres psql -Atc "select version();" >/dev/null
  echo "psql_ok"
  exit 0
fi

sudo mkdir -p "${out_dir}"

for db in ${DBS}; do
  dump="${out_dir}/${db}.dump"
  list="${out_dir}/${db}.pg_restore.list.txt"
  echo "--- dumping ${db}"

  # Fail fast if DB doesn't exist yet (phase00-004 not executed).
  if ! sudo -u postgres psql -Atc "select 1 from pg_database where datname='${db}'" | grep -q "^1$"; then
    echo "ERROR: database does not exist: ${db}" >&2
    echo "Hint: run phase00-004 (init-ct107-neanelu.sql) first." >&2
    exit 3
  fi

  sudo -u postgres pg_dump -Fc --no-owner --no-acl -d "${db}" -f "${dump}"
  sudo -u postgres pg_restore --list "${dump}" > "${list}"
  sha256sum "${dump}" > "${dump}.sha256"
done

echo "--- compressing metadata"
gzip -f "${out_dir}"/*.pg_restore.list.txt

echo "--- retention (local)"
find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d -name 'ct107_neanelu_*' -mtime "+${RETENTION_DAYS}" -print -exec rm -rf {} \;

echo "--- done local backup: ${out_dir}"

# Optional upload to Storage Box (best-effort; do not fail the backup if upload is not configured)
if [[ -n "${STORAGEBOX_HOST:-}" && -n "${STORAGEBOX_USER:-}" && -n "${STORAGEBOX_PATH:-}" ]]; then
  need_bin ssh
  need_bin scp

  port="${STORAGEBOX_PORT:-23}"
  ssh_opts=(-p "${port}" -o StrictHostKeyChecking=accept-new)
  if [[ -n "${STORAGEBOX_SSH_KEY:-}" ]]; then
    ssh_opts+=(-i "${STORAGEBOX_SSH_KEY}")
  fi

  remote="${STORAGEBOX_USER}@${STORAGEBOX_HOST}"
  remote_dir="${STORAGEBOX_PATH%/}/${run_id}"

  echo "--- storagebox upload configured"
  echo "remote: ${remote}"
  echo "path:   ${remote_dir}"

  ssh "${ssh_opts[@]}" "${remote}" "mkdir -p '${remote_dir}'"
  scp "${ssh_opts[@]}" -r "${out_dir}/" "${remote}:'${remote_dir}/'"
  echo "--- storagebox upload done"
else
  echo "--- storagebox upload skipped (env not set)"
fi

