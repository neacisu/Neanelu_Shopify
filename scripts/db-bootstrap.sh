#!/bin/bash
# ============================================
# Database Bootstrap Script - F2.1.2.2
# ============================================
# Creează rolurile app_migrator și app_runtime pentru least privilege
#
# IMPORTANT: Acest script se rulează O SINGURĂ DATĂ per mediu!
# NU este o migrație drizzle - necesită credențiale superuser.
#
# Utilizare:
#   ./scripts/db-bootstrap.sh
#
# Environment variables OBLIGATORII (fără defaults pentru secrete!):
#   - DB_HOST (default: localhost - doar pentru dev)
#   - DB_PORT (default: 65010 - doar pentru dev)
#   - DB_NAME - numele bazei de date (OBLIGATORIU)
#   - POSTGRES_USER - userul PostgreSQL owner (OBLIGATORIU)
#   - POSTGRES_SUPERUSER_PASSWORD sau POSTGRES_PASSWORD (OBLIGATORIU)
#   - MIGRATION_DB_PASSWORD - parola pentru app_migrator (OBLIGATORIU)
#   - RUNTIME_DB_PASSWORD - parola pentru app_runtime (OBLIGATORIU)
#
# Securitate:
#   - Parolele NU sunt hardcodate în script
#   - Parolele se furnizează prin environment variables
#   - În producție, parolele vin din secret manager (OpenBAO/Vault)
# ============================================

set -euo pipefail

# ============================================
# CONFIGURARE - TOATE valorile din environment!
# ============================================
# NICIO valoare hardcodată - totul vine din environment variables

# Variabile de infrastructură (cu defaults pentru localhost dev)
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-65010}"

# ============================================
# VERIFICĂRI OBLIGATORII - Fără defaults!
# ============================================

missing_vars=()

[[ -z "${DB_NAME:-}" ]] && missing_vars+=("DB_NAME")
[[ -z "${POSTGRES_USER:-}" ]] && missing_vars+=("POSTGRES_USER")
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
    echo "   Setează variabilele înainte de a rula scriptul:"
    echo "   export DB_NAME=<numele_bazei_de_date>"
    echo "   export POSTGRES_USER=<userul_postgres>"
    echo "   export POSTGRES_PASSWORD=<parola_din_secret_manager>"
    echo "   export MIGRATION_DB_PASSWORD=<parola_din_secret_manager>"
    echo "   export RUNTIME_DB_PASSWORD=<parola_din_secret_manager>"
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
echo "============================================"

# ============================================
# CREARE ROLURI
# ============================================

echo ""
echo "📌 Pas 1: Creare roluri app_migrator și app_runtime..."

psql -h "$DB_HOST" -p "$DB_PORT" -U "$POSTGRES_USER" -d "$DB_NAME" <<SQL
-- ============================================
-- ROLURI DATABASE
-- ============================================
-- app_migrator: Rol pentru migrații DDL (CREATE, ALTER, DROP)
-- app_runtime: Rol pentru operațiuni DML (SELECT, INSERT, UPDATE, DELETE)

-- Verifică dacă rolurile există deja
DO \$\$
BEGIN
    -- Creează app_migrator dacă nu există
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator') THEN
        CREATE ROLE app_migrator WITH LOGIN;
        RAISE NOTICE '✅ Rol app_migrator creat';
    ELSE
        RAISE NOTICE 'ℹ️ Rol app_migrator există deja';
    END IF;

    -- Creează app_runtime dacă nu există
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
        CREATE ROLE app_runtime WITH LOGIN;
        RAISE NOTICE '✅ Rol app_runtime creat';
    ELSE
        RAISE NOTICE 'ℹ️ Rol app_runtime există deja';
    END IF;
END
\$\$;

-- ============================================
-- PRIVILEGII app_migrator (DDL - migrații)
-- ============================================
-- Privilegii complete pe schema public pentru DDL operations

GRANT ALL PRIVILEGES ON SCHEMA public TO app_migrator;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_migrator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_migrator;

-- Default privileges pentru tabele create în viitor
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
    GRANT ALL PRIVILEGES ON TABLES TO app_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
    GRANT ALL PRIVILEGES ON SEQUENCES TO app_migrator;

-- ============================================
-- PRIVILEGII app_runtime (DML - runtime)
-- ============================================
-- Doar USAGE pe schema, SELECT/INSERT/UPDATE/DELETE pe tabele
-- NU are DROP, CREATE, ALTER

GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;

-- Default privileges pentru tabele create în viitor
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
    GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;

-- ============================================
-- PRIVILEGIU SPECIAL: SET pentru RLS context
-- ============================================
-- Permite app_runtime să seteze app.current_shop_id pentru RLS

GRANT SET ON PARAMETER app.current_shop_id TO app_runtime;

-- ============================================
-- PRIVILEGII pe schema drizzle (migrations tracking)
-- ============================================
-- app_migrator trebuie să poată scrie în tabelul de migrații
-- Schema drizzle se creează la prima migrație, deci verificăm existența

DO \$\$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'drizzle') THEN
        EXECUTE 'GRANT USAGE ON SCHEMA drizzle TO app_migrator';
        EXECUTE 'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA drizzle TO app_migrator';
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

# Setăm parolele separat pentru securitate
psql -h "$DB_HOST" -p "$DB_PORT" -U "$POSTGRES_USER" -d "$DB_NAME" -c \
    "ALTER ROLE app_migrator PASSWORD '$MIGRATION_DB_PASSWORD';"

psql -h "$DB_HOST" -p "$DB_PORT" -U "$POSTGRES_USER" -d "$DB_NAME" -c \
    "ALTER ROLE app_runtime PASSWORD '$RUNTIME_DB_PASSWORD';"

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
WHERE rolname IN ('app_migrator', 'app_runtime')
ORDER BY rolname;
SQL

echo ""
echo "============================================"
echo "✅ Bootstrap completat cu succes!"
echo "============================================"
echo ""
echo "Connection strings:"
echo "  DATABASE_URL_MIGRATE=postgresql://app_migrator:***@$DB_HOST:$DB_PORT/$DB_NAME"
echo "  DATABASE_URL=postgresql://app_runtime:***@$DB_HOST:$DB_PORT/$DB_NAME"
echo ""
echo "Următorul pas: Testează conexiunea cu app_runtime"
echo "============================================"
