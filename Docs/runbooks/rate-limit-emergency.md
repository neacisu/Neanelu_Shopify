# Rate Limit Emergency Runbook

> **Last Updated:** 2025-12-25  
> **Severity:** High  
> **On-call Required:** Yes (if affecting production shops)

---

## Purpose

This runbook documents procedures for handling Shopify API rate limiting emergencies, including persistent 429 errors and budget exhaustion.

---

## Understanding Shopify Rate Limits

### Standard Limits (GraphQL Admin API)

| Shop Type    | Bucket Size  | Restore Rate   |
| ------------ | ------------ | -------------- |
| Standard     | 1,000 points | 50 points/sec  |
| Shopify Plus | 2,000 points | 100 points/sec |

### Bulk Operations

- 1 concurrent operation per shop (API 2025-10)
- 5 concurrent operations (API 2026-01+)

---

## Scenario 1: Persistent 429 Errors

### Symptoms

- Worker logs show repeated "429 Too Many Requests"
- `api_cost_tracking` shows high `actual_cost` values
- Queue jobs stuck in delayed state

### Diagnosis

1. **Check current bucket status:**

   ```sql
   SELECT * FROM rate_limit_buckets
   WHERE shop_id = '{shop_id}';
   ```

2. **Review recent API costs:**

   ```sql
   SELECT
     operation_type,
     SUM(actual_cost) as total_cost,
     COUNT(*) as request_count
   FROM api_cost_tracking
   WHERE shop_id = '{shop_id}'
     AND requested_at > NOW() - INTERVAL '1 hour'
   GROUP BY operation_type
   ORDER BY total_cost DESC;
   ```

3. **Identify expensive queries:**

   ```sql
   SELECT * FROM api_cost_tracking
   WHERE shop_id = '{shop_id}'
     AND actual_cost > 500  -- High cost threshold
   ORDER BY requested_at DESC LIMIT 20;
   ```

### Resolution

**Immediate - Stop the bleeding:**

```bash
# Pause all jobs for this shop
redis-cli HSET bull:sync-queue:groups:{shop_id} paused 1
```

**Short-term - Wait for refill:**

```bash
# Calculate wait time
# If bucket is empty: 1000 points / 50 per sec = 20 seconds
sleep 30
```

**Resume with reduced concurrency:**

```bash
# Update shop-specific limit
redis-cli SET neanelu:ratelimit:{shop_id}:concurrency 1
# Resume jobs
redis-cli HDEL bull:sync-queue:groups:{shop_id} paused
```

---

## Scenario 2: Bulk Operation Quota Exhausted

### Symptoms

- Error: "Maximum number of bulk operations reached"
- New bulk syncs failing to start

### Resolution

1. **Check active operations:**

   ```graphql
   query {
     currentBulkOperation {
       id
       status
       createdAt
     }
   }
   ```

2. **Cancel stuck operation (if safe):**

   ```graphql
   mutation {
     bulkOperationCancel(id: "gid://shopify/BulkOperation/{id}") {
       bulkOperation {
         status
       }
       userErrors {
         message
       }
     }
   }
   ```

3. **Wait for natural completion:**
   - If operation is processing data, let it finish
   - Set up webhook: `BULK_OPERATIONS_FINISH`

---

## Scenario 3: Shop-wide API Suspension

### Symptoms

- All API calls return 402 or 423
- Shop may be locked by Shopify

### Investigation

1. **Check Shopify Partners Dashboard:**
   - Look for app suspension notices
   - Check for TOS violations

2. **Verify shop status:**

   ```sql
   SELECT * FROM shops
   WHERE shopify_domain = '{domain}'
   -- Check: uninstalled_at, plan_tier
   ```

### Resolution

- Contact Shopify Partner Support
- Review API usage patterns for violations
- Document incident for future prevention

---

## Manual Bucket Adjustment

> ⚠️ **Use with caution** - Only for emergency recovery

```sql
-- Reset bucket to full
UPDATE rate_limit_buckets SET
  tokens_remaining = max_tokens,
  last_refill_at = NOW()
WHERE shop_id = '{shop_id}';
```

```bash
# Also update Redis cache
redis-cli HSET neanelu:ratelimit:{shop_id} tokens 1000 last_refill "$(date +%s)"
```

---

## Prevention Strategies

### 1. Cost-based Query Optimization

```typescript
// Before executing query, estimate cost
const estimatedCost = await estimateQueryCost(query);
if (estimatedCost > availableBudget * 0.8) {
  // Split into smaller queries
  await splitAndExecute(query);
}
```

### 2. Adaptive Concurrency

```typescript
// Reduce concurrency when approaching limits
if (tokensRemaining < 200) {
  await worker.setRateLimiter({ max: 1, duration: 5000 });
}
```

### 3. Bulk Operations for Large Reads

- Never paginate > 1000 items with GraphQL
- Always use Bulk Operations for catalog syncs

### 4. Webhook Processing Deduplication

```typescript
// Use Bloom filter for webhook dedup
if (await bloomFilter.exists(webhookId)) {
  return { status: 'already_processed' };
}
```

---

## Escalation Path

1. **Self-service (< 30 min):**
   - Wait for bucket refill
   - Reduce concurrency

2. **On-call Engineer (30+ min):**
   - Investigate query patterns
   - Implement emergency limits

3. **Shopify Support (persistent issues):**
   - Request limit increase for Plus shops
   - Report potential API issues

---

## Monitoring Alerts

Set up alerts for:

- `tokens_remaining < 100` for any shop
- `COUNT(429 errors) > 10` in 5 minutes
- Bulk operation running > 6 hours

---

## Related Documents

- `Docs/Stack Tehnologic Complet pnpm Shopify.md` Section 4.2
- `Docs/Strategie_dezvoltare.md` Section 6.2
- `Plan_de_implementare.md` F4.3 (Rate Limiting)
