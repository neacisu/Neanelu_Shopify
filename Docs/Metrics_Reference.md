# Metrics Reference - Neanelu Shopify

> **Version:** 1.0 | **Last Updated:** 2026-01-06
> **Sources:**
>
> - `apps/backend-worker/src/otel/metrics.ts`
> - `packages/queue-manager/src/queue-manager.ts` + `packages/queue-manager/src/job-delay.ts`

---

## HTTP Metrics

| Metric                          | Type      | Labels                     | Description           |
|---------------------------------|-----------|----------------------------|-----------------------|
| `http_request_total`            | Counter   | method, route, status_code | Total HTTP requests   |
| `http_request_duration_seconds` | Histogram | method, route              | Request latency       |
| `http_request_size_bytes`       | Histogram | method, route              | Request body size     |
| `http_response_size_bytes`      | Histogram | method, route              | Response body size    |
| `http_5xx_total`                | Counter   | method, route, status_code | Server errors for SLO |
| `http_active_requests`          | Gauge     | -                          | Concurrent requests   |

---

## Webhook Metrics

| Metric                                     | Type      | Labels                     | Description           |
|--------------------------------------------|-----------|----------------------------|-----------------------|
| `webhook_accepted_total`                   | Counter   | topic                      | Webhooks accepted     |
| `webhook_rejected_total`                   | Counter   | reason                     | Webhooks rejected     |
| `webhook_duplicate_total`                  | Counter   | topic                      | Deduplicated webhooks |
| `webhook_processing_duration_seconds`      | Histogram | topic                      | E2E processing time   |
| `webhook_hmac_validation_duration_seconds` | Histogram | -                          | HMAC validation time  |
| `webhook_payload_size_bytes`               | Histogram | -                          | Payload size          |

**Rejection Reasons:** missing_headers, invalid_shop, invalid_hmac, payload_too_large, invalid_json

---

## Queue Metrics

| Metric                               | Type      | Labels     | Description                               |
|--------------------------------------|-----------|------------|-------------------------------------------|
| `queue_enqueue_total`                | Counter   | queue_name | Jobs enqueued                             |
| `queue_depth`                        | Gauge     | queue_name | Jobs waiting                              |
| `queue_active`                       | Gauge     | queue_name | Jobs currently executing (best-effort)    |
| `queue_job_latency_seconds`          | Histogram | queue_name | Time from enqueue to processing start     |
| `queue_job_duration_seconds`         | Histogram | queue_name | Processing duration                       |
| `queue_job_retries_total`            | Counter   | queue_name | Non-terminal failures (retry attempts)    |
| `queue_job_backoff_seconds`          | Histogram | queue_name | Backoff before retry (best-effort)        |
| `queue_job_failed_total`             | Counter   | queue_name | Jobs that ended in failure (terminal)     |
| `queue_job_stalled_total`            | Counter   | queue_name | Jobs detected as stalled                  |
| `queue_dlq_entries_total`            | Counter   | queue_name | Jobs moved to DLQ                         |
| `queue_ratelimit_delayed_total`      | Counter   | queue_name | Jobs delayed due to rate limiting         |
| `queue_ratelimit_delay_seconds`      | Histogram | queue_name | Rate limit delay duration                 |
| `queue_fairness_group_delayed_total` | Counter   | queue_name | Grouped jobs waiting >1s (best-effort)    |
| `queue_fairness_group_wait_seconds`  | Histogram | queue_name | Grouped job wait time (best-effort)       |

**Queue naming (Source of Truth):** kebab-case. DLQ queues use `-dlq` suffix (ex: `webhook-queue-dlq`).

---

## Database Metrics

| Metric                       | Type      | Labels     | Description        |
|------------------------------|-----------|------------|--------------------|
| `db_query_duration_seconds`  | Histogram | operation  | Query latency      |
| `db_pool_connections_active` | Gauge     | -          | Active connections |
| `db_pool_connections_idle`   | Gauge     | -          | Idle connections   |

**Operations:** select, insert, update, delete, copy

---

## Redis Metrics

| Metric                           | Type      | Labels     | Description        |
|----------------------------------|-----------|------------|--------------------|
| `redis_command_duration_seconds` | Histogram | -          | Command latency    |
| `redis_connection_errors_total`  | Counter   | -          | Connection errors  |

---

## AI / Vector Search Metrics

| Metric                               | Type      | Labels | Description                                  |
|--------------------------------------|-----------|--------|----------------------------------------------|
| `openai_embed_ratelimit_allowed_total` | Counter | -      | Embedding requests allowed by rate limiter   |
| `openai_embed_ratelimit_denied_total`  | Counter | -      | Embedding requests denied by rate limiter    |
| `openai_embed_ratelimit_delay_seconds` | Histogram | -    | Delay imposed by embedding rate limiter      |
| `vector_search_latency_seconds`        | Histogram | -    | Vector search latency                        |
| `vector_search_cache_hit_total`        | Counter   | -    | Vector search cache hits                     |
| `vector_search_cache_miss_total`       | Counter   | -    | Vector search cache misses                   |

---

## OAuth Metrics

| Metric                      | Type    | Labels | Description       |
|-----------------------------|---------|--------|-------------------|
| `oauth_login_success_total` | Counter | -      | Successful logins |
| `oauth_login_failed_total`  | Counter | reason | Failed logins     |
| `oauth_token_refresh_total` | Counter | -      | Token refreshes   |

---

## Shopify API Metrics

| Metric                          | Type    | Labels | Description       |
|---------------------------------|---------|--------|-------------------|
| `shopify_api_cost_points_total` | Counter | -      | API cost consumed |
| `shopify_rate_limit_hits_total` | Counter | -      | 429 responses     |

---

## SLO Calculations

```promql
# API Availability (target: 99.9%)
1 - (sum(http_5xx_total) / sum(http_request_total))

# Webhook Latency P99 (target: <200ms)
histogram_quantile(0.99, webhook_processing_duration_seconds_bucket)

# API Latency P95 (target: <500ms)
histogram_quantile(0.95, http_request_duration_seconds_bucket)
```

---

## Cardinality Rules

> [!CAUTION]
> **DO NOT use these as metric labels:**

- `shop_domain` / `shop_id` (high cardinality)
- `webhook_id` / `job_id` (unique per event)
- `user_id` / `customer_id` (PII + high cardinality)

> Use traces for per-entity debugging instead.

---

## Future Metrics (F4.4+)

Aceste metrici vor fi adăugate în fazele ulterioare:

### Queue Metrics (F4.4)

Metricile de bază pentru cozi sunt deja definite mai sus și folosesc convenția `queue_*`.
Pentru evitarea drift-ului între documentație și implementare, nu mai folosim dot-notation.

### Bulk Operations (F5.3)

- `bulk.duration_seconds` - bulk operation duration
- `bulk.bytes_processed_total` - bytes processed
- `bulk.rows_processed_total` - rows processed
- `bulk.errors_total` - error count by type
- `bulk.active_operations` - active operations gauge
- `bulk.backlog_bytes` - pending bytes gauge

### AI Pipeline (F6.3)

- `ai.backlog_items` - items waiting for AI processing
- `ai.batch_age_seconds` - age of oldest batch
- `ai.items_processed_total` - processed items count
- `ai.errors_total` - AI errors count
- `ai.query_latency_ms` - semantic query latency
- `ai.redis_sync_lag` - Redis sync delay

---

## Related Documentation

- [Observability & Alerting](./Observability_Alerting.md) - Alert rules and SLOs
- [SRE Performance Report](./SRE_Performance_Report.md) - Performance targets
- [Port Conventions](./Port_Conventions.md) - OTel ports (65020-65025)
