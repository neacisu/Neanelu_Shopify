# Observability & Alerting Rules

> **Stack:** OpenTelemetry + Prometheus + Grafana + Loki
> **Version:** 1.0 | **Last Updated:** 2026-01-06

---

## 1. Alert Severity Levels

| Level | Response Time | Escalation | Examples |
| ----- | ------------- | ---------- | -------- |
| **CRITICAL** | < 15 min | PagerDuty/SMS | DB down, bulk stuck, auth broken |
| **WARNING** | < 1 hour | Slack #alerts | High latency, memory spike |
| **INFO** | Next business day | Slack #monitoring | Approaching limits |

---

## 2. Prometheus Alert Rules

### Queue Alerts

```yaml
# prometheus/rules/queue-alerts.yml
groups:
  - name: queue-alerts
    rules:
      - alert: QueueStalledJobsHigh
        expr: sum(increase(queue_job_stalled_total[5m])) > 10
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High number of stalled jobs"
          description: "{{ $value }} jobs stalled for >5 min"
          runbook_url: "Docs/runbooks/bulk-operation-stuck.md"

      - alert: QueueFailedRateSpike
        expr: sum(rate(queue_job_failed_total[5m])) > 0.1
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Job failure rate spike"
          description: "Failure rate: {{ $value | humanizePercentage }}"

      - alert: QueueBacklogGrowing
        expr: sum(queue_depth) > 1000
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Queue backlog growing"
          description: "{{ $value }} jobs waiting"

      - alert: QueueDLQEntriesSpike
        expr: increase(queue_dlq_entries_total[5m]) > 0
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Jobs entering DLQ"
          description: "{{ $value }} jobs moved to DLQ in last 5 min"
          runbook_url: "Docs/runbooks/bulk-operation-stuck.md"

      - alert: QueueRetryRateSpike
        expr: sum(rate(queue_job_retries_total[5m])) > 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Job retry rate spike"
          description: "Retry rate: {{ $value }} retries/sec"

      - alert: QueueRatelimitDelaysHigh
        expr: sum(increase(queue_ratelimit_delayed_total[5m])) > 0
        for: 5m
        labels:
          severity: info
        annotations:
          summary: "Rate-limit delays observed"
          description: "{{ $value }} jobs delayed due to rate limiting in last 5 min"
```

### API Cost Alerts

```yaml
# prometheus/rules/shopify-alerts.yml
groups:
  - name: shopify-api-alerts
    rules:
      - alert: ShopifyAPICostSpike
        expr: |
          sum(rate(shopify_api_cost_points_total[1h])) 
          > 2 * avg_over_time(sum(rate(shopify_api_cost_points_total[1h]))[24h:1h])
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "Shopify API cost spike detected"
          description: "Cost >2x 24h average"

      - alert: ShopifyRateLimitHit
        expr: increase(shopify_rate_limit_hits_total[5m]) > 5
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Hitting Shopify rate limits"
          description: "{{ $value }} 429s in last 5 min"
          runbook_url: "Docs/runbooks/rate-limit-emergency.md"
```

### Infrastructure Alerts

```yaml
# prometheus/rules/infra-alerts.yml
groups:
  - name: infrastructure-alerts
    rules:
      - alert: RedisLatencyHigh
        expr: redis_commands_duration_seconds_avg > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Redis latency >50ms"
          description: "Current latency: {{ $value | humanizeDuration }}"

      - alert: PostgresConnectionsExhausted
        expr: pg_stat_activity_count / pg_settings_max_connections > 0.9
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL connections at 90%"
          description: "{{ $value | humanizePercentage }} connections used"

      - alert: WorkerMemoryHigh
        expr: container_memory_usage_bytes{container="backend-worker"} 
              / container_spec_memory_limit_bytes > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Worker memory >80%"
          description: "Memory at {{ $value | humanizePercentage }}"

      - alert: DiskSpaceLow
        expr: node_filesystem_avail_bytes{mountpoint="/"} 
              / node_filesystem_size_bytes < 0.1
        for: 10m
        labels:
          severity: critical
        annotations:
          summary: "Disk space <10%"
          description: "{{ $value | humanize1024 }}B remaining"
```

### Bulk Operations Alerts

```yaml
# prometheus/rules/bulk-alerts.yml
groups:
  - name: bulk-operation-alerts
    rules:
      - alert: BulkOperationStuck
        expr: |
          bulk_operation_running_age_seconds > 3600
        labels:
          severity: critical
        annotations:
          summary: "Bulk operation stuck >1h"
          description: "Bulk operation running for {{ $value }}s"
          runbook_url: "Docs/runbooks/bulk-operation-stuck.md"

      - alert: BulkOperationFailedConsecutive
        expr: |
          sum(increase(bulk_operation_failed_total[1h])) by (operation_type) >= 3
        labels:
          severity: critical
        annotations:
          summary: "3+ bulk failures per operation type"
          description: "Operation type {{ $labels.operation_type }} failing repeatedly"
```

---

## 3. Grafana Dashboard Panels

### Dashboard: System Overview

| Panel | Query | Visualization |
| ----- | ----- | ------------- |
| Active Jobs | `sum(queue_active)` | Stat |
| Failed Rate | `sum(rate(queue_job_failed_total[5m]))` | Gauge |
| API Cost/hour | `sum(rate(shopify_api_cost_points_total[1h]))` | Timeseries |
| P95 Latency | `histogram_quantile(0.95, http_request_duration_seconds_bucket)` | Timeseries |
| Memory Usage | `container_memory_usage_bytes{container=~".*worker.*"}` | Timeseries |

---

## 4. SLOs (Service Level Objectives)

| SLI | Target | Measurement |
| --- | ------ | ----------- |
| API Availability | 99.9% | `1 - (http_5xx / http_total)` |
| Webhook Latency (p99) | <200ms | `histogram_quantile(0.99, ...)` |
| Bulk Success Rate | >99% | `success / total` |
| Queue Processing Time (p95) | <5min | Job duration histogram |

---

## 5. Alert Notification Channels

```yaml
# alertmanager/config.yml
route:
  group_by: ['alertname', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: 'slack-default'
  routes:
    - match:
        severity: critical
      receiver: 'pagerduty-oncall'
    - match:
        severity: warning
      receiver: 'slack-alerts'

receivers:
  - name: 'slack-default'
    slack_configs:
      - channel: '#monitoring'
        send_resolved: true
        
  - name: 'slack-alerts'
    slack_configs:
      - channel: '#alerts'
        send_resolved: true
        
  - name: 'pagerduty-oncall'
    pagerduty_configs:
      - service_key: '${PAGERDUTY_KEY}'
```
