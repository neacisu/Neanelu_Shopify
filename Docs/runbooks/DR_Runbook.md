# Disaster Recovery Runbook

> **RPO:** 1 hour | **RTO:** 4 hours | **Last Drill:** TODO Q1 2026
> **Version:** 1.0 | **Last Updated:** 2025-12-26

---

## 1. Backup Strategy Overview

| Component          | Method              | Frequency      | Retention |
| ------------------ | ------------------- | -------------- | --------- |
| PostgreSQL         | pg_basebackup + WAL | Continuous     | 30 days   |
| Redis              | AOF + RDB snapshot  | Hourly RDB     | 7 days    |
| Application Config | Git + OpenBAO       | On change      | ∞         |
| Secrets            | OpenBAO             | Snapshot daily | 90 days   |

---

## 2. PostgreSQL Backup Configuration

### Continuous Archiving (WAL)

```bash
# postgresql.conf
archive_mode = on
archive_command = 'gzip < %p > /backup/wal/%f.gz'
archive_timeout = 300
```

### Base Backup Cron Script

```bash
#!/bin/bash
# /opt/scripts/pg_backup.sh
# Schedule: 0 2 * * * (daily at 2 AM)

set -euo pipefail

BACKUP_DIR="/backup/postgres"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="${BACKUP_DIR}/base_${TIMESTAMP}"

# Create base backup
pg_basebackup -h localhost -U replicator -D "${BACKUP_PATH}" \
  --format=tar --gzip --checkpoint=fast --label="neanelu_${TIMESTAMP}"

# Cleanup old backups (keep 7 days)
find "${BACKUP_DIR}" -name "base_*" -mtime +7 -delete

# Verify backup
pg_verifybackup "${BACKUP_PATH}" || {
  echo "CRITICAL: Backup verification failed!" | \
    mail -s "Backup Failed" oncall@company.com
  exit 1
}

echo "Backup completed: ${BACKUP_PATH}"
```

### WAL Archiving Script

```bash
#!/bin/bash
# /opt/scripts/archive_wal.sh

WAL_FILE="$1"
ARCHIVE_PATH="/backup/wal/${WAL_FILE}.gz"

gzip -c "$2" > "${ARCHIVE_PATH}"

# Upload to S3 (optional off-site)
# aws s3 cp "${ARCHIVE_PATH}" s3://neanelu-backups/wal/
```

---

## 3. Redis Backup Configuration

### AOF + RDB Persistence

```conf
# redis.conf
appendonly yes
appendfsync everysec
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb

save 3600 1
save 300 100
save 60 10000

dir /data/redis
dbfilename dump.rdb
appendfilename appendonly.aof
```

### Backup Script

```bash
#!/bin/bash
# /opt/scripts/redis_backup.sh
# Schedule: 0 * * * * (hourly)

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backup/redis"

# Store current LASTSAVE timestamp before triggering backup
LAST_SAVE=$(redis-cli LASTSAVE)

# Trigger BGSAVE
redis-cli BGSAVE

# Wait for completion
while [ "$(redis-cli LASTSAVE)" == "$LAST_SAVE" ]; do
  sleep 1
done

# Copy RDB file
cp /data/redis/dump.rdb "${BACKUP_DIR}/dump_${TIMESTAMP}.rdb"

# Cleanup (keep 7 days)
find "${BACKUP_DIR}" -name "dump_*.rdb" -mtime +7 -delete
```

---

## 4. Recovery Procedures

### Scenario 1: PostgreSQL Point-in-Time Recovery (PITR)

```bash
# Step 1: Stop services
docker compose stop backend-worker

# Step 2: Stop PostgreSQL
docker compose stop db

# Step 3: Remove corrupted data
rm -rf /data/postgres/*

# Step 4: Restore base backup
tar -xzf /backup/postgres/base_20251225_020000/* -C /data/postgres/

# Step 5: Create recovery signal
touch /data/postgres/recovery.signal

# Step 6: Configure recovery target
cat > /data/postgres/postgresql.auto.conf << EOF
restore_command = 'gunzip -c /backup/wal/%f.gz > %p'
recovery_target_time = '2025-12-25 14:30:00+00'
recovery_target_action = 'promote'
EOF

# Step 7: Start PostgreSQL
docker compose up -d db

# Step 8: Monitor recovery
docker compose logs -f db 2>&1 | grep -i recovery

# Step 9: Verify data
docker compose exec db psql -U neanelu -c "SELECT count(*) FROM shopify_products;"

# Step 10: Resume services
docker compose up -d backend-worker
```

### Scenario 2: Full System Recovery

```bash
# Step 1: Provision bare-metal server
# [Manual: Order server, install Docker]

# Step 2: Clone repository
git clone https://github.com/neacisu/Neanelu_Shopify.git

# Step 3: Restore secrets from OpenBAO backup
bao server -config=/etc/openbao/config.hcl &
bao operator unseal  # Use 3 keys from different admins

# Step 4: Restore PostgreSQL (see Scenario 1)

# Step 5: Restore Redis
cp /backup/redis/dump_latest.rdb /data/redis/dump.rdb
docker compose up -d redis

# Step 6: Pull and start application
docker compose pull
docker compose up -d

# Step 7: Run migrations (if needed)
pnpm run db:migrate

# Step 8: Verify health
curl http://localhost:65000/health/ready
```

### Scenario 3: Redis Data Recovery

```bash
# Stop Redis
docker compose stop redis

# Replace AOF/RDB
cp /backup/redis/dump_latest.rdb /data/redis/dump.rdb
# OR for AOF: cp /backup/redis/appendonly_latest.aof /data/redis/

# Start Redis
docker compose up -d redis

# Verify
redis-cli DBSIZE
```

---

## 5. DR Drill Checklist

### Quarterly Drill Procedure

- [ ] **Prepare:** Schedule 4-hour maintenance window
- [ ] **Notify:** Alert team and stakeholders
- [ ] **Backup Current State:** Fresh pg_dump before drill
- [ ] **Simulate Failure:** Stop PostgreSQL container
- [ ] **Execute Recovery:** Follow Scenario 1 steps
- [ ] **Measure RTO:** Time from failure to recovery
- [ ] **Validate RPO:** Check data age after recovery
- [ ] **Document:** Log all issues and timing
- [ ] **Improve:** Update runbook with lessons learned

### Success Criteria

| Metric                 | Target   | Actual (Last Drill) |
| ---------------------- | -------- | ------------------- |
| RTO                    | <4 hours | TODO Q1 2026        |
| RPO                    | <1 hour  | TODO Q1 2026        |
| Data Integrity         | 100%     | TODO Q1 2026        |
| Zero Downtime Failover | n/a      | TODO Q1 2026        |

---

## 6. Emergency Contacts

| Role             | Contact                | Escalation    |
| ---------------- | ---------------------- | ------------- |
| On-Call Engineer | PagerDuty              | Auto          |
| Database Admin   | TODO Q1 2026           | 15 min        |
| Security Lead    | TODO Q1 2026           | Critical only |
| Shopify Support  | <partners@shopify.com> | API issues    |

---

## 7. Related Runbooks

- [Database Failover](./database-failover.md)
- [OpenBAO Recovery](./openbao-recovery.md)
- [Rate Limit Emergency](./rate-limit-emergency.md)
- [Bulk Operation Stuck](./bulk-operation-stuck.md)
