# Database Failover Runbook

> **Last Updated:** 2025-12-25  
> **Severity:** Critical  
> **On-call Required:** Yes

---

## Purpose

This runbook documents recovery procedures for PostgreSQL 18.1 database failover scenarios on bare-metal deployment.

---

## Architecture Overview

```
Primary DB (Active) ─────────────────────────►  Application
     │
     │ Streaming Replication
     ▼
Standby DB (Hot Standby) ────────────────────►  Read Replicas (if used)
```

---

## Scenario 1: Primary Database Down - Planned Failover

### Pre-requisites

- Standby is up-to-date (lag < 1 minute)
- Maintenance window scheduled
- Backup verified

### Failover Steps

1. **Stop application traffic:**

   ```bash
   docker compose stop backend-worker web-admin
   ```

2. **Verify standby is current:**

   ```sql
   -- On standby
   SELECT pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn();
   ```

3. **Promote standby:**

   ```bash
   docker exec postgres-standby pg_ctl promote -D /var/lib/postgresql/data
   ```

4. **Update connection strings:**

   ```bash
   # Update .env or OpenBAO
   export DATABASE_URL="postgresql://user:pass@new-primary:5432/neanelu"
   ```

5. **Restart applications:**

   ```bash
   docker compose up -d backend-worker web-admin
   ```

6. **Verify connectivity:**

   ```bash
   psql $DATABASE_URL -c "SELECT 1"
   ```

---

## Scenario 2: Primary Database Down - Emergency Failover

### Symptoms

- Application errors: "Connection refused"
- Health checks failing
- Primary host unreachable

### Emergency Steps

1. **Confirm primary is truly down:**

   ```bash
   pg_isready -h primary-host -p 5432
   ```

2. **Check replication lag before promoting:**

   ```sql
   -- On standby
   SELECT EXTRACT(EPOCH FROM (NOW() - pg_last_xact_replay_timestamp())) AS lag_seconds;
   ```

3. **Accept data loss if lag > 60s:**
   - Document approximate data loss window
   - Get approval from on-call lead

4. **Promote standby immediately:**

   ```bash
   docker exec postgres-standby pg_ctl promote -D /var/lib/postgresql/data
   ```

5. **Update DNS/Load Balancer or connection strings**

6. **Notify team of potential data loss window**

---

## Scenario 3: Point-in-Time Recovery (PITR)

### When to Use

- Accidental data deletion
- Application bug caused data corruption
- Need to recover to specific timestamp

### Recovery Steps

1. **Stop all applications:**

   ```bash
   docker compose down
   ```

2. **Identify recovery target:**

   ```bash
   # Find when the problem occurred
   grep "DELETE FROM" /var/log/postgresql/postgresql.log
   ```

3. **Create recovery configuration:**

   ```ini
   # recovery.conf or postgresql.auto.conf
   restore_command = 'cp /var/lib/postgresql/wal_archive/%f %p'
   recovery_target_time = '2025-12-25 14:30:00'
   recovery_target_action = 'promote'
   ```

4. **Start PostgreSQL in recovery mode:**

   ```bash
   docker compose up -d postgres
   ```

5. **Verify recovered data:**

   ```sql
   SELECT COUNT(*) FROM critical_table;
   -- Compare with expected count
   ```

6. **Resume applications after verification**

---

## Scenario 4: Corrupted Database

### Symptoms

- PostgreSQL won't start
- Errors: "could not open file"
- Consistency check failures

### Resolution

1. **Attempt recovery mode:**

   ```bash
   docker exec postgres pg_resetwal -D /var/lib/postgresql/data
   ```

2. **If resetwal fails, restore from backup:**

   ```bash
   # Stop container
   docker compose stop postgres

   # Move corrupted data
   mv /var/lib/postgresql/data /var/lib/postgresql/data.corrupt

   # Restore from backup
   pg_restore -d neanelu /backups/latest.dump

   # Start container
   docker compose up -d postgres
   ```

3. **Apply WAL logs if available:**

   ```bash
   # Automatic if wal_archive is configured
   ```

---

## Backup Verification Checklist

### Weekly

- [ ] Test restore to staging environment
- [ ] Verify backup timestamps are recent
- [ ] Check backup file sizes are consistent

### Monthly

- [ ] Full restore drill to fresh environment
- [ ] Measure RTO (Recovery Time Objective)
- [ ] Update documentation if procedures changed

---

## Connection Pool Recovery

After failover, connection pools may have stale connections.

```bash
# Force pool refresh
docker compose restart backend-worker

# Or if using pgbouncer
pgbouncer -R /etc/pgbouncer/pgbouncer.ini
```

---

## RLS Context Recovery

After failover, verify RLS policies are intact:

```sql
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE tablename IN ('shopify_products', 'shopify_orders');
```

---

## Related Documents

- `Docs/Arhitectura Baza de Date PostgreSQL Detaliata.md`
- `Docs/Database_Schema_Complete.md`
- `Plan_de_implementare.md` F2 (Data Layer)
