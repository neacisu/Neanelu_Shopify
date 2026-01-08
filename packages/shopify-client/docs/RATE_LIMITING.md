# Shopify Rate Limiting Strategy

## Overview

Shopify enforces rate limits on all API calls to ensure fair resource usage across all apps and stores. This document describes the three rate limiting mechanisms used by Shopify and how our client handles each one.

## Rate Limiting Mechanisms

### 1. GraphQL Cost-Based Rate Limiting

Shopify GraphQL Admin API uses a **calculated query cost** model with a leaky bucket algorithm.

| Parameter              | Value                           |
| ---------------------- | ------------------------------- |
| Bucket size (max cost) | 2,000 points                    |
| Restore rate           | 100 points/second               |
| Query cost             | Calculated per query complexity |

#### Response Headers

Each GraphQL response includes cost information in the extensions:

```json
{
  "extensions": {
    "cost": {
      "requestedQueryCost": 42,
      "actualQueryCost": 42,
      "throttleStatus": {
        "maximumAvailable": 2000,
        "currentlyAvailable": 1958,
        "restoreRate": 100
      }
    }
  }
}
```

#### Client Implementation

Our client uses `computeGraphqlDelayMs()` from `src/rate-limiting.ts`:

```typescript
import { computeGraphqlDelayMs } from '@app/shopify-client/rate-limiting';

const result = await client.graphql(query);
const delayMs = computeGraphqlDelayMs(result.extensions?.cost, { headroom: 200, minDelayMs: 0 });

if (delayMs > 0) {
  await sleep(delayMs);
}
```

**Parameters:**

- `headroom` (default: 200) — Reserve tokens to handle concurrent requests
- `minDelayMs` (default: 0) — Minimum delay between requests

---

### 2. REST 429 + Retry-After Rate Limiting

Shopify REST Admin API uses a standard HTTP 429 response with `Retry-After` header.

| Parameter   | Value                      |
| ----------- | -------------------------- |
| Limit       | 40 requests per app/store  |
| Time window | Rolling window             |
| Recovery    | Wait `Retry-After` seconds |

#### Response Format

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 2.0
X-Shopify-Shop-Api-Call-Limit: 40/40
```

#### REST Client Implementation

Our client uses `computeRestDelayMsFromRetryAfter()`:

```typescript
import { computeRestDelayMsFromRetryAfter } from '@app/shopify-client/rate-limiting';

try {
  return await client.rest.get('/products.json');
} catch (error) {
  if (error.status === 429) {
    const delayMs = computeRestDelayMsFromRetryAfter(error.headers.get('Retry-After'), {
      maxDelayMs: 60_000,
    });
    await sleep(delayMs);
    return retry();
  }
  throw error;
}
```

**Parameters:**

- `maxDelayMs` (default: 60_000) — Cap on delay to prevent extremely long waits

---

### 3. Bulk Operations Concurrency

Shopify allows only **one concurrent bulk operation per shop** for mutations and one for queries.

| Constraint                    | Value      |
| ----------------------------- | ---------- |
| Max concurrent bulk mutations | 1 per shop |
| Max concurrent bulk queries   | 1 per shop |
| Result file lifetime          | 7 days     |

#### Bulk Lock Implementation

Our queue-manager uses distributed Redis locks via `bulk-lock.ts`:

```typescript
import { acquireBulkLock, releaseBulkLock } from '@app/queue-manager/locks/bulk-lock';

const handle = await acquireBulkLock(redis, shopId, { ttlMs: 600_000 });
if (!handle) {
  throw new Error('Another bulk operation is running for this shop');
}

try {
  await executeBulkOperation(shopId, mutation);
} finally {
  await releaseBulkLock(redis, handle);
}
```

**Lock Features:**

- Atomic acquire via Lua script
- TTL-based expiration for crash recovery
- Automatic renewal for long-running operations
- Token-based ownership verification

---

## Integration with Queue Manager

### Fairness via BullMQ Pro Groups

Each shop gets isolated queue groups to prevent one shop from starving others:

```typescript
await queue.add(
  'sync-products',
  { shopId },
  {
    group: { id: normalizeShopIdToGroupId(shopId) },
  }
);
```

### Token Bucket Rate Limiter

The `rate-limiter.ts` module provides atomic Redis-based rate limiting:

```typescript
import { checkAndConsumeCost } from '@app/queue-manager/strategies/fairness/rate-limiter';

const result = await checkAndConsumeCost(redis, {
  bucketKey: `ratelimit:${shopId}`,
  costToConsume: queryCost,
  maxTokens: 2000,
  refillPerSecond: 100,
});

if (!result.allowed) {
  // Delay by result.delayMs before retrying
  throw new RateLimitError(result.delayMs);
}
```

---

## Metrics & Observability

### Available Metrics

| Metric                       | Type      | Labels       | Description                            |
| ---------------------------- | --------- | ------------ | -------------------------------------- |
| `ratelimit_allowed_total`    | Counter   | `bucket_key` | Requests that passed rate limiting     |
| `ratelimit_denied_total`     | Counter   | `bucket_key` | Requests denied by rate limiter        |
| `ratelimit_delay_seconds`    | Histogram | `bucket_key` | Distribution of delay times            |
| `bulk_lock_acquire_total`    | Counter   | —            | Successful lock acquisitions           |
| `bulk_lock_contention_total` | Counter   | —            | Lock acquisition failures (contention) |
| `bulk_lock_release_total`    | Counter   | —            | Lock releases                          |

### Grafana Dashboards

Pre-configured dashboards available at:

- `docker/grafana/provisioning/dashboards/queue-manager.json`

---

## Best Practices

1. **Always check costs before queries** — Use `actualQueryCost` from previous similar queries to estimate upcoming costs

2. **Respect Retry-After headers** — Never implement fixed delays; use the header value

3. **Use headroom for concurrent workers** — With N workers, set headroom to ~200 \* N

4. **Monitor bulk lock contention** — High contention indicates too many bulk operations queued

5. **Implement exponential backoff** — For transient failures, use the queue manager's built-in backoff:

   ```typescript
   backoff: { type: 'neanelu-exp4', delay: 1000 }
   ```

---

## References

- [Shopify GraphQL Rate Limits](https://shopify.dev/docs/api/usage/rate-limits#graphql-admin-api-rate-limits)
- [Shopify REST Rate Limits](https://shopify.dev/docs/api/usage/rate-limits#rest-admin-api-rate-limits)
- [Bulk Operations Guide](https://shopify.dev/docs/api/usage/bulk-operations/queries)
