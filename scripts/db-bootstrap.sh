#!/bin/bash
# ============================================
# Database Bootstrap Script - F2.1.2.2
# ============================================
# Creează rolurile pentru least privilege (migrații și runtime)
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
#   - POSTGRES_USER - userul PostgreSQL owner (OBLIGATORIU)
#   - POSTGRES_SUPERUSER_PASSWORD sau POSTGRES_PASSWORD (OBLIGATORIU)
#   - MIGRATOR_ROLE_NAME - numele rolului pentru migrații (OBLIGATORIU)
#   - RUNTIME_ROLE_NAME - numele rolului pentru runtime (OBLIGATORIU)
#   - MIGRATION_DB_PASSWORD - parola pentru rolul migrator (OBLIGATORIU)
#   - RUNTIME_DB_PASSWORD - parola pentru rolul runtime (OBLIGATORIU)
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
[[ -z "${MIGRATOR_ROLE_NAME:-}" ]] && missing_vars+=("MIGRATOR_ROLE_NAME")
[[ -z "${RUNTIME_ROLE_NAME:-}" ]] && missing_vars+=("RUNTIME_ROLE_NAME")
[[ -z "${MIGRATION_DB_PASSWORD:-}" ]] && missing_vars+=("MIGRATION_DB_PASSWORD")
[[ -z "${RUNTIME_DB_PASSWORD:-}" ]] && missing_vars+=("RUNTIME_DB_PASSWORD")

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
MIGRATOR_ROLE="${MIGRATOR_ROLE_NAME}"
RUNTIME_ROLE="${RUNTIME_ROLE_NAME}"

# PGPASSWORD pentru autentificare psql
# Prioritate: POSTGRES_SUPERUSER_PASSWORD > POSTGRES_PASSWORD
export PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD:-${POSTGRES_PASSWORD}}"

echo "============================================"
echo "🔧 Database Bootstrap - Roluri & Privilegii"
echo "============================================"
echo "Host: $DB_HOST:$DB_PORT"
echo "Database: $DB_NAME"
echo "Migrator Role: $MIGRATOR_ROLE"
echo "Runtime Role: $RUNTIME_ROLE"
echo "============================================"

# ============================================
# CREARE ROLURI
# ============================================

echo ""
echo "📌 Pas 1: Creare roluri..."

# Folosim substituție bash directă (heredoc fără quotes)
psql -h "$DB_HOST" -p "$DB_PORT" -U "$POSTGRES_USER" -d "$DB_NAME" <<SQL
-- ============================================
-- ROLURI DATABASE
-- ============================================
-- Rol migrator: pentru migrații DDL (CREATE, ALTER, DROP)
-- Rol runtime: pentru operațiuni DML (SELECT, INSERT, UPDATE, DELETE)

-- Verifică dacă rolurile există deja
DO \$\$
BEGIN
    -- Creează rolul migrator dacă nu există
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$MIGRATOR_ROLE') THEN
        EXECUTE format('CREATE ROLE %I WITH LOGIN', '$MIGRATOR_ROLE');
        RAISE NOTICE '✅ Rol $MIGRATOR_ROLE creat';
    ELSE
        RAISE NOTICE 'ℹ️ Rol $MIGRATOR_ROLE există deja';
    END IF;

    -- Creează rolul runtime dacă nu există
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$RUNTIME_ROLE') THEN
        EXECUTE format('CREATE ROLE %I WITH LOGIN', '$RUNTIME_ROLE');
        RAISE NOTICE '✅ Rol $RUNTIME_ROLE creat';
    ELSE
        RAISE NOTICE 'ℹ️ Rol $RUNTIME_ROLE există deja';
    END IF;
END
\$\$;

-- ============================================
-- PRIVILEGII migrator (DDL - migrații)
-- ============================================
GRANT ALL PRIVILEGES ON SCHEMA public TO $MIGRATOR_ROLE;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $MIGRATOR_ROLE;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $MIGRATOR_ROLE;

ALTER DEFAULT PRIVILEGES IN SCHEMA public 
    GRANT ALL PRIVILEGES ON TABLES TO $MIGRATOR_ROLE;
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
    GRANT ALL PRIVILEGES ON SEQUENCES TO $MIGRATOR_ROLE;

-- ============================================
-- PRIVILEGII runtime (DML - runtime)
-- ============================================
GRANT USAGE ON SCHEMA public TO $RUNTIME_ROLE;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO $RUNTIME_ROLE;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $RUNTIME_ROLE;

ALTER DEFAULT PRIVILEGES IN SCHEMA public 
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO $RUNTIME_ROLE;
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
    GRANT USAGE, SELECT ON SEQUENCES TO $RUNTIME_ROLE;

-- ============================================
-- PRIVILEGIU SPECIAL: SET pentru RLS context
-- ============================================
GRANT SET ON PARAMETER app.current_shop_id TO $RUNTIME_ROLE;

-- ============================================
-- PRIVILEGII pe schema drizzle (migrations tracking)
-- ============================================
DO \$\$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'drizzle') THEN
        EXECUTE 'GRANT USAGE ON SCHEMA drizzle TO $MIGRATOR_ROLE';
        EXECUTE 'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA drizzle TO $MIGRATOR_ROLE';
        RAISE NOTICE '✅ Privilegii acordate pe schema drizzle';
    ELSE
        RAISE NOTICE 'ℹ️ Schema drizzle nu există încă (se creează la prima migrație)';
    END IF;
END
\$\$;

SQL

echo "   ✅ Roluri și privilegii configurate"

# ============================================
# SETARE PAROLE
# ============================================

echo ""
echo "📌 Pas 2: Setare parole pentru roluri..."

# Setăm parolele separat pentru securitate (folosind variabile bash, nu hardcodat)
psql -h "$DB_HOST" -p "$DB_PORT" -U "$POSTGRES_USER" -d "$DB_NAME" -c \
    "ALTER ROLE $MIGRATOR_ROLE PASSWORD '$MIGRATION_DB_PASSWORD';"

psql -h "$DB_HOST" -p "$DB_PORT" -U "$POSTGRES_USER" -d "$DB_NAME" -c \
    "ALTER ROLE $RUNTIME_ROLE PASSWORD '$RUNTIME_DB_PASSWORD';"

echo "   ✅ Parole setate (din environment variables)"

# ============================================
# VERIFICARE
# ============================================

echo ""
echo "📌 Pas 3: Verificare roluri..."

psql -h "$DB_HOST" -p "$DB_PORT" -U "$POSTGRES_USER" -d "$DB_NAME" <<SQL
SELECT 
    rolname as "Rol",
    rolcanlogin as "Can Login",
    rolcreatedb as "Can Create DB",
    rolcreaterole as "Can Create Role",
    rolsuper as "Superuser"
FROM pg_roles 
WHERE rolname IN ('$MIGRATOR_ROLE', '$RUNTIME_ROLE')
ORDER BY rolname;
SQL

echo ""
echo "============================================"
echo "✅ Bootstrap completat cu succes!"
echo "============================================"
echo ""
echo "Connection strings (înlocuiește *** cu parolele):"
echo "  DATABASE_URL_MIGRATE=postgresql://$MIGRATOR_ROLE:***@$DB_HOST:$DB_PORT/$DB_NAME"
echo "  DATABASE_URL=postgresql://$RUNTIME_ROLE:***@$DB_HOST:$DB_PORT/$DB_NAME"
echo ""
echo "Următorul pas: Testează conexiunea cu rolul runtime"
echo "============================================"
