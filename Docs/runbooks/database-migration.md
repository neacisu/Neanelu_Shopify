# Runbook: Database Migration

> **Severity:** P2 (Moderate) | **On-Call Required:** Yes  
> **Last Updated:** 2025-12-26 | **Author:** DevOps Team

---

## Overview

Acest runbook descrie procedura pentru executarea migrațiilor de baze de date în producție folosind pattern-ul **Expand/Contract** pentru zero-downtime deployments.

---

## Prerequisites

- [ ] Acces SSH la serverul de producție
- [ ] Credențiale PostgreSQL (read/write)
- [ ] Backup recent verificat (< 1h)
- [ ] Migrația testată pe staging
- [ ] Rollback script pregătit
- [ ] Maintenance window comunicată (dacă e necesar)

---

## Expand/Contract Pattern

### Conceptul

Pattern-ul Expand/Contract permite migrații fără downtime prin separarea schimbărilor în două faze:

```
┌─────────────────────────────────────────────────────────────┐
│  EXPAND                                                     │
│  - Adaugă coloane noi (nullable sau cu default)             │
│  - Creează tabele noi                                       │
│  - Adaugă indexuri noi (CONCURRENTLY)                       │
│  - Schema suportă AMBELE versiuni de cod                    │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  DEPLOY NEW CODE                                            │
│  - Aplicația scrie în coloanele noi și vechi               │
│  - Citește din coloanele noi cu fallback la vechi           │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  CONTRACT                                                   │
│  - Șterge coloanele vechi (după migrarea datelor)           │
│  - Șterge indexuri nefolosite                               │
│  - Adaugă constraints NOT NULL pe coloanele noi             │
└─────────────────────────────────────────────────────────────┘
```

---

## Pre-Migration Checklist (T-30min)

### 1. Verificare Backup

```bash
# Verifică ultimul backup
ls -la /var/backups/postgres/

# Sau cu pg_dump pentru backup manual
pg_dump -Fc -h localhost -p 65010 -U postgres neanelu_shopify_prod \
  > /var/backups/postgres/pre_migration_$(date +%Y%m%d_%H%M).dump

# Verifică integritatea backup-ului
pg_restore --list /var/backups/postgres/pre_migration_*.dump | head -20
```

### 2. Verificare Conexiuni Active

```sql
-- Verifică numărul de conexiuni active
SELECT count(*), state
FROM pg_stat_activity
WHERE datname = 'neanelu_shopify_prod'
GROUP BY state;

-- Verifică tranzacții long-running
SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE (now() - pg_stat_activity.query_start) > interval '5 minutes'
  AND state != 'idle';
```

### 3. Verificare Load

```bash
# Verifică load-ul serverului
uptime
free -h
df -h

# Verifică conexiunile Redis (pentru queue drain)
redis-cli -p 65011 INFO clients
```

---

## Migration Execution

### Pasul 1: Drain Queues (Opțional pentru migrații majore)

```bash
# Oprește procesarea de job-uri noi
curl -X POST http://localhost:65000/admin/queues/pause

# Așteaptă finalizarea job-urilor active
while [ $(redis-cli -p 65011 LLEN bull:sync:active) -gt 0 ]; do
  echo "Waiting for active jobs to complete..."
  sleep 5
done
```

### Pasul 2: Executare Migrație EXPAND

```bash
# Cu Drizzle
cd /var/www/Neanelu_Shopify
pnpm --filter @app/database run migrate

# Sau manual pentru control granular
psql -h localhost -p 65010 -U postgres -d neanelu_shopify_prod \
  -f packages/database/migrations/XXXX_expand_migration.sql
```

### Pasul 3: Verificare Post-EXPAND

```sql
-- Verifică că noile coloane/tabele există
\d+ numele_tabelului

-- Verifică RLS policies sunt intacte
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'numele_tabelului';
```

### Pasul 4: Deploy New Code

```bash
# Deploy aplicația care suportă ambele scheme
docker compose pull
docker compose up -d --no-deps backend-worker

# Verifică că aplicația pornește corect
curl -s http://localhost:65000/health/ready | jq
```

### Pasul 5: Migrare Date (dacă e necesar)

```sql
-- Exemplu: migrare date din coloană veche în coloană nouă
UPDATE products
SET new_column = old_column
WHERE new_column IS NULL
  AND old_column IS NOT NULL;

-- Pentru tabele mari, folosește batch updates
DO $$
DECLARE
  batch_size INT := 10000;
  affected INT;
BEGIN
  LOOP
    WITH batch AS (
      SELECT id FROM products
      WHERE new_column IS NULL AND old_column IS NOT NULL
      LIMIT batch_size
      FOR UPDATE SKIP LOCKED
    )
    UPDATE products p
    SET new_column = p.old_column
    FROM batch b
    WHERE p.id = b.id;

    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;

    RAISE NOTICE 'Migrated % rows', affected;
    PERFORM pg_sleep(0.1); -- Pauză pentru a nu bloca
  END LOOP;
END $$;
```

### Pasul 6: Executare Migrație CONTRACT

```bash
# După ce codul nou rulează stabil (min 24h recomandat)
psql -h localhost -p 65010 -U postgres -d neanelu_shopify_prod \
  -f packages/database/migrations/XXXX_contract_migration.sql
```

---

## Rollback Procedure

### Rollback Rapid (< 5 min de la migrație)

```bash
# Oprește aplicația nouă
docker compose stop backend-worker

# Rollback migrație Drizzle (dacă suportă)
pnpm --filter @app/database run migrate:rollback

# Sau manual
psql -h localhost -p 65010 -U postgres -d neanelu_shopify_prod \
  -f packages/database/migrations/XXXX_rollback.sql

# Repornește cu versiunea veche
docker compose up -d backend-worker
```

### Rollback din Backup (ultima soluție)

```bash
# ATENȚIE: Va pierde datele de după backup!

# 1. Oprește toate serviciile
docker compose down

# 2. Restore din backup
pg_restore -h localhost -p 65010 -U postgres -d neanelu_shopify_prod \
  --clean --if-exists \
  /var/backups/postgres/pre_migration_YYYYMMDD_HHMM.dump

# 3. Repornește serviciile cu versiunea veche de cod
git checkout v1.2.3  # versiunea anterioară
docker compose up -d
```

---

## Post-Migration Verification

### Verificări Imediate (T+5min)

```bash
# Health check
curl -s http://localhost:65000/health/ready | jq

# Verifică logs pentru erori
docker logs backend-worker --since 5m | grep -i error

# Verifică metrici aplicație
curl -s http://localhost:65000/metrics | grep -E "http_requests_total|db_query_duration"
```

### Verificări SQL

```sql
-- Verifică integritatea datelor
SELECT COUNT(*) FROM products WHERE shop_id IS NULL;

-- Verifică RLS funcționează
SET LOCAL app.current_shop_id = '00000000-0000-0000-0000-000000000000';
SELECT COUNT(*) FROM products;  -- Trebuie să returneze 0

-- Verifică indexuri
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'products';
```

### Verificări Funcționale

- [ ] OAuth flow funcționează
- [ ] Webhook-urile sunt procesate
- [ ] Bulk operations pornesc corect
- [ ] Query-uri principale < 100ms

---

## Common Migration Patterns

### Adăugare Coloană Nouă (Safe)

```sql
-- EXPAND: Adaugă coloană nullable
ALTER TABLE products ADD COLUMN new_field TEXT;

-- CONTRACT (după deploy): Adaugă constraint
ALTER TABLE products ALTER COLUMN new_field SET NOT NULL;
ALTER TABLE products ALTER COLUMN new_field SET DEFAULT '';
```

### Redenumire Coloană (2-Phase)

```sql
-- EXPAND: Adaugă coloană nouă, trigger pentru sync
ALTER TABLE products ADD COLUMN new_name TEXT;

CREATE OR REPLACE FUNCTION sync_old_to_new() RETURNS TRIGGER AS $$
BEGIN
  NEW.new_name := NEW.old_name;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_column
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION sync_old_to_new();

-- Migrare date existente
UPDATE products SET new_name = old_name WHERE new_name IS NULL;

-- CONTRACT (după deploy):
DROP TRIGGER trg_sync_column ON products;
DROP FUNCTION sync_old_to_new();
ALTER TABLE products DROP COLUMN old_name;
```

### Adăugare Index (CONCURRENTLY)

```sql
-- ALWAYS use CONCURRENTLY pentru producție
CREATE INDEX CONCURRENTLY idx_products_new
ON products (new_column)
WHERE deleted_at IS NULL;

-- Verifică progresul
SELECT * FROM pg_stat_progress_create_index;
```

---

## Escalation Path

| Timp    | Acțiune                          |
| ------- | -------------------------------- |
| T+5min  | Verifică logs, metrici           |
| T+15min | Dacă erori persistă → rollback   |
| T+30min | Notifică tech lead               |
| T+1h    | Post-mortem dacă a fost rollback |

---

## Related Runbooks

- [Database Failover](./database-failover.md)
- [DR Runbook](./DR_Runbook.md)
- [Bulk Operation Stuck](./bulk-operation-stuck.md)

---

**Document creat conform AUDIT 2025-12-26 (P2-3.8)**
