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
         partialDataUrl
       }
     }
   }
   ```

2. **Check operation status in database:**

   ```sql
   SELECT
     id,
     status,
     shop_id,
     operation_type,
     query_type,
     retry_count,
     max_retries,
     shopify_operation_id,
     started_at,
     completed_at,
     error_message,
     cursor_state
   FROM bulk_runs
   WHERE id = '{bulk_run_id}';
   ```

3. **Check Redis for job state:**

   ```bash
   redis-cli HGETALL bull:bulk-queue:job:{job_id}
   ```

### Resolution Steps

**If Shopify shows COMPLETED but DB shows RUNNING:**

```sql
-- Prefer: let the poller reconcile first.
-- If you must hotfix, set result_url and store the URL as an artifact.
UPDATE bulk_runs
SET status = 'completed',
      completed_at = NOW(),
      result_url = '{url_from_shopify}',
      updated_at = NOW()
WHERE id = '{bulk_run_id}';

INSERT INTO bulk_artifacts (
   bulk_run_id,
   shop_id,
   artifact_type,
   file_path,
   url,
   created_at
)
VALUES (
   '{bulk_run_id}',
   '{shop_id}',
   'shopify_bulk_result_url',
   'shopify://bulk/{bulk_run_id}/result',
   '{url_from_shopify}',
   NOW()
)
ON CONFLICT DO NOTHING;
```

**If Shopify shows RUNNING:**

- Wait - Shopify is still processing
- Check for throttling in shop's API costs

**If Shopify shows FAILED:**

```sql
-- Note: poller applies enterprise failure policy:
-- - transient failures can auto-retry up to max_retries
-- - permanent failures can go DLQ-direct
-- Only force to failed if you're sure no retry is pending.
UPDATE bulk_runs
SET status = 'failed',
      completed_at = NOW(),
      error_message = '{error_from_shopify}',
      updated_at = NOW()
WHERE id = '{bulk_run_id}';

INSERT INTO bulk_errors (
   bulk_run_id,
   shop_id,
   error_type,
   error_code,
   error_message,
   payload,
   created_at
)
VALUES (
   '{bulk_run_id}',
   '{shop_id}',
   'poller_terminal',
   '{error_code_from_shopify}',
   '{error_from_shopify}',
   jsonb_build_object('source', 'manual_runbook'),
   NOW()
);

-- If Shopify provided partialDataUrl, store it for later salvage.
-- (This is normally done automatically by the poller.)
INSERT INTO bulk_artifacts (
   bulk_run_id,
   shop_id,
   artifact_type,
   file_path,
   url,
   created_at
)
VALUES (
   '{bulk_run_id}',
   '{shop_id}',
   'shopify_bulk_partial_url',
   'shopify://bulk/{bulk_run_id}/partial',
   '{partial_data_url_from_shopify}',
   NOW()
)
ON CONFLICT DO NOTHING;
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

## Scenario 2b: Job moved to DLQ (DLQ-direct or attempts exhausted)

### DLQ Symptoms

- Bulk worker logs: "job moved to DLQ"
- Queue `${QUEUE_NAME}-dlq` contains an entry with `originalQueue`, `failedReason`

### DLQ Diagnosis Steps

1. Inspect DLQ entry payload fields:
   - `originalQueue`, `originalJobId`, `attemptsMade`, `failedReason`, `data`
2. Check `bulk_errors` and `bulk_runs.retry_count/max_retries` for context.

### DLQ Resolution

- Permanent failures (auth/query invalid) are configuration issues; fix scopes/credentials and re-run.
- Transient failures that hit max retries usually indicate infra/rate-limit pressure; stabilize first, then start a fresh run.

---

## Scenario 3: Download URL Expired

### URL Expired Symptoms

- Operation completed but `result_url` returns 403/410
- Error: "URL signature expired"

### URL Expired Resolution

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

### OOM Symptoms

- Container restarts during ingest phase
- Error logs: "JavaScript heap out of memory"
- Large file size (> 1GB)

### OOM Resolution

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
