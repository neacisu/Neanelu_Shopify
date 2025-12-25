# Bulk Operation Stuck Runbook

> **Last Updated:** 2025-12-25  
> **Severity:** High  
> **On-call Required:** Depends on duration

---

## Purpose

This runbook documents recovery procedures for Shopify Bulk Operations that become stuck or fail to complete within expected timeframes.

---

## Expected Timelines

| Catalog Size      | Expected Duration | Alert After |
| ----------------- | ----------------- | ----------- |
| < 10K products    | 5-15 minutes      | 30 minutes  |
| 10K-100K products | 15-60 minutes     | 2 hours     |
| 100K-1M products  | 1-4 hours         | 6 hours     |
| > 1M products     | 4-24 hours        | 24 hours    |

---

## Scenario 1: Bulk Operation in RUNNING State Too Long

### Symptoms

- `bulk_runs.status = 'running'` for longer than expected
- No progress in `records_processed`
- Worker logs show no activity for this operation

### Diagnosis Steps

1. **Check operation status in Shopify:**

   ```graphql
   query {
     node(id: "gid://shopify/BulkOperation/{ID}") {
       ... on BulkOperation {
         status
         errorCode
         objectCount
         fileSize
         url
       }
     }
   }
   ```

2. **Check operation status in database:**

   ```sql
   SELECT * FROM bulk_runs
   WHERE id = '{bulk_run_id}'
   -- Check: shopify_operation_id, started_at, records_processed
   ```

3. **Check Redis for job state:**

   ```bash
   redis-cli HGETALL bull:bulk-queue:job:{job_id}
   ```

### Resolution Steps

**If Shopify shows COMPLETED but DB shows RUNNING:**

```sql
-- Force status update
UPDATE bulk_runs SET
  status = 'completed',
  completed_at = NOW(),
  result_url = '{url_from_shopify}'
WHERE id = '{bulk_run_id}';
```

**If Shopify shows RUNNING:**

- Wait - Shopify is still processing
- Check for throttling in shop's API costs

**If Shopify shows FAILED:**

```sql
UPDATE bulk_runs SET
  status = 'failed',
  completed_at = NOW(),
  error_message = '{error_from_shopify}'
WHERE id = '{bulk_run_id}';
```

---

## Scenario 2: Bulk Operation Failed with THROTTLED

### Resolution

1. **Check API cost budget:**

   ```sql
   SELECT * FROM api_cost_tracking
   WHERE shop_id = '{shop_id}'
   ORDER BY requested_at DESC LIMIT 10;
   ```

2. **Wait for bucket refill:**
   - Shopify refills at 50 points/second
   - Full bucket = 1000 points
   - Wait ~20 seconds for full refill

3. **Retry with exponential backoff:**

   ```bash
   # Manually trigger retry
   pnpm run queue:dispatch bulk-sync --shop-id={shop_id} --retry=true
   ```

---

## Scenario 3: Download URL Expired

### Symptoms

- Operation completed but `result_url` returns 403/410
- Error: "URL signature expired"

### Resolution

1. **Re-run the bulk operation:**
   - Shopify signed URLs expire after 7 days
   - There is no way to regenerate the URL without re-running

2. **Mark old run as failed:**

   ```sql
   UPDATE bulk_runs SET
     status = 'failed',
     error_message = 'Result URL expired before processing'
   WHERE id = '{bulk_run_id}';
   ```

3. **Create new bulk run:**

   ```bash
   pnpm run sync:full --shop-id={shop_id}
   ```

---

## Scenario 4: Worker OOM During JSONL Processing

### Symptoms

- Container restarts during ingest phase
- Error logs: "JavaScript heap out of memory"
- Large file size (> 1GB)

### Resolution

1. **Increase worker memory limit:**

   ```yaml
   # docker-compose.yml
   services:
     worker:
       deploy:
         resources:
           limits:
             memory: 4G # Increase from 2G
   ```

2. **Check streaming implementation:**
   - Verify `pg-copy-streams` is being used
   - Verify chunk size is reasonable (1000 records)
   - Check for memory leaks in transform stream

3. **Restart with higher memory:**

   ```bash
   docker compose up -d worker
   ```

---

## Prevention

### Monitoring Alerts

- Set up alert for `bulk_runs.status = 'running' AND started_at < NOW() - INTERVAL '6 hours'`
- Monitor worker memory usage via Prometheus/Grafana

### Automatic Cleanup

- Cron job to mark stale operations as failed after 24 hours
- Regular cleanup of completed bulk_runs older than 30 days

---

## Related Documents

- `Plan_de_implementare.md` F5 (Bulk Pipeline)
- `Docs/Stack Tehnologic Complet pnpm Shopify.md` Section 4.1
