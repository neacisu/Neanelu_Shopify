#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# CT107 - Neanelu pre-deploy pg_dump wrapper
# =============================================================================
# Runs as: sudo -u postgres /opt/neanelu/infra/scripts/ct107_ci_pgdump.sh <db_name>
# Outputs custom-format dump to stdout (pipe to file on caller side).
# Excludes drizzle schema (migration tracking only, not business data).
# =============================================================================

DB_NAME="${1:?Usage: $0 <db_name>}"

exec pg_dump -d "${DB_NAME}" -Fc --no-owner --no-acl --exclude-schema=drizzle
