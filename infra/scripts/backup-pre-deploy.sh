#!/usr/bin/env bash
# =============================================================================
# Neanelu Shopify - Pre-deploy backup helper
# =============================================================================
# Scop:
# - Ruleaza backup-ul PostgreSQL pe CT107 inainte de deploy (staging/prod)
# - Foloseste scriptul SoT: infra/scripts/ct107_backup_postgres_neanelu.sh (executat pe CT107)
#
# Rulare (de pe runner / operator machine cu SSH aliases):
#   ENV=staging bash infra/scripts/backup-pre-deploy.sh
#   ENV=production bash infra/scripts/backup-pre-deploy.sh
#
# Necesita:
# - SSH alias `postgres-main` functional
# =============================================================================

set -euo pipefail

ENVIRONMENT="${ENV:-staging}"

case "${ENVIRONMENT}" in
  staging)
    DBS="neanelu_shopify_staging"
    ;;
  production|prod)
    DBS="neanelu_shopify"
    ;;
  *)
    echo "ERROR: unknown ENV=${ENVIRONMENT} (use staging|production)" >&2
    exit 2
    ;;
esac

echo "backup_pre_deploy env=${ENVIRONMENT} dbs=${DBS}"

# Copy script to CT107 (aditiv), then execute it there.
tmp="/tmp/ct107_backup_postgres_neanelu.sh"
scp -q /var/www/Neanelu_Shopify/infra/scripts/ct107_backup_postgres_neanelu.sh "postgres-main:${tmp}"
ssh -o BatchMode=yes postgres-main "chmod 0750 ${tmp} && DBS='${DBS}' sudo bash ${tmp}"
ssh -o BatchMode=yes postgres-main "rm -f ${tmp} || true"

echo "ok"

