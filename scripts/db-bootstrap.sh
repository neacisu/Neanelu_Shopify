#!/bin/bash
# ============================================
# Database Bootstrap Script - F2.1.2.2
# ============================================
# Normalizează owner-ul DB/tabelelor la un singur user
#
# IMPORTANT: Acest script se rulează O SINGURĂ DATĂ per mediu!
# NU este o migrație drizzle - necesită credențiale superuser.
#
# Utilizare:
#   ./scripts/db-bootstrap.sh
#
# Environment variables OBLIGATORII (ZERO hardcodări!):
#   - DB_HOST (default: localhost - doar pentru dev)
#   - DB_PORT (default: 65010 - doar pentru dev)
#   - DB_NAME - numele bazei de date (OBLIGATORIU)
#   - POSTGRES_USER - owner-ul DB/tabele (OBLIGATORIU)
#   - POSTGRES_SUPERUSER_PASSWORD sau POSTGRES_PASSWORD (OBLIGATORIU)
#
# Securitate:
#   - ZERO valori hardcodate în script (nici parole, nici useri, nici nume roluri)
#   - Toate valorile se furnizează prin environment variables
#   - În producție, secretele vin din secret manager (OpenBAO/Vault)
# ============================================

set -euo pipefail

# ============================================
# CONFIGURARE - TOTUL din environment!
# ============================================
# ZERO valori hardcodate - totul vine din environment variables

# Variabile de infrastructură (cu defaults pentru localhost dev)
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-65010}"

# ============================================
# VERIFICĂRI OBLIGATORII - ZERO defaults!
# ============================================

missing_vars=()

[[ -z "${DB_NAME:-}" ]] && missing_vars+=("DB_NAME")
[[ -z "${POSTGRES_USER:-}" ]] && missing_vars+=("POSTGRES_USER")

# Verifică parola superuser
if [[ -z "${POSTGRES_SUPERUSER_PASSWORD:-}" ]] && [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
    missing_vars+=("POSTGRES_SUPERUSER_PASSWORD sau POSTGRES_PASSWORD")
fi

if [[ ${#missing_vars[@]} -gt 0 ]]; then
    echo "❌ ERROR: Variabile de environment lipsă!"
    echo ""
    echo "   Variabile necesare:"
    for var in "${missing_vars[@]}"; do
        echo "   - $var"
    done
    echo ""
    echo "   Setează variabilele înainte de a rula scriptul."
    echo "   Consultă .env.example pentru format."
    exit 1
fi

# Folosim variabilele din environment
DB_NAME="${DB_NAME}"
POSTGRES_USER="${POSTGRES_USER}"

# PGPASSWORD pentru autentificare psql
# Prioritate: POSTGRES_SUPERUSER_PASSWORD > POSTGRES_PASSWORD
export PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD:-${POSTGRES_PASSWORD}}"

echo "============================================"
echo "🔧 Database Bootstrap - Roluri & Privilegii"
echo "============================================"
echo "Host: $DB_HOST:$DB_PORT"
echo "Database: $DB_NAME"
echo "DB Owner: $POSTGRES_USER"
echo "============================================"

# ============================================
# NORMALIZARE OWNER
# ============================================

echo ""
echo "📌 Pas 1: Setare owner DB + tabele..."

psql -h "$DB_HOST" -p "$DB_PORT" -U "$POSTGRES_USER" -d "$DB_NAME" <<SQL
ALTER DATABASE $DB_NAME OWNER TO $POSTGRES_USER;

DO \$\$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT format('%I.%I', schemaname, tablename) AS fqtn
           FROM pg_tables
          WHERE schemaname = 'public'
  LOOP
    EXECUTE 'ALTER TABLE ' || r.fqtn || ' OWNER TO $POSTGRES_USER';
  END LOOP;
END
\$\$;
SQL

echo "   ✅ Owner setat pentru DB și tabele"

# ============================================
echo ""
echo "============================================"
echo "✅ Bootstrap completat cu succes!"
echo "============================================"
echo ""
echo "Connection string:"
echo "  DATABASE_URL=postgresql://$POSTGRES_USER:***@$DB_HOST:$DB_PORT/$DB_NAME"
echo "============================================"
