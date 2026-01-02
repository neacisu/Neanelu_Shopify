# LogQL Queries pentru Debugging

Această pagină conține queries LogQL comune pentru investigare în Grafana/Loki.

## Queries de Bază

### Toate logurile pentru un serviciu

```logql
{service="backend-worker"}
```

### Loguri de eroare

```logql
{service=~".+"} |= "error" | json
```

### Loguri pentru un shop specific

```logql
{shop_id="<uuid>"} | json
```

## Queries pentru Diagnoză

### Corelare trace - toate logurile pentru un trace ID

```logql
{trace_id="<trace-id>"} | json | sort by (timestamp)
```

### Top 10 erori unice în ultima oră

```logql
sum by (error_code) (count_over_time({level="error"} | json [1h])) | topk 10
```

### Rate de erori per minut per serviciu

```logql
sum(rate({level="error"}[1m])) by (service)
```

### Loguri pentru un job ID specific

```logql
{job_id="<job-id>"} | json
```

## Queries pentru Incidente

### Shopify 429 Errors

```logql
{service="backend-worker"} |= "429" | json | line_format "{{.shop_id}} - {{.message}}"
```

### BullMQ Job Failures

```logql
{service="backend-worker"} |= "job failed" | json
```

### Database Connection Issues

```logql
{service=~".+"} |= "connection" |= "error" | json
```

### Redis Errors

```logql
{service=~".+"} |= "redis" |= "error" | json
```

## Queries pentru Performance

### Slow Requests (>1s)

```logql
{service="backend-worker"} | json | duration > 1s
```

### Request Latency Distribution

```logql
quantile_over_time(0.95, {service="backend-worker"} | json | unwrap duration [5m]) by (route)
```

## Tips

1. **Folosește time range corect** - Nu căuta în mai mult de 24h fără filtre
2. **Filtrează devreme** - Pune filtrele de label ({}) înainte de parsers (| json)
3. **Limitează cardinalitatea** - Nu folosi `by (shop_id)` pe queries mari
4. **Testează incremental** - Rulează query-ul fără parsers pentru a vedea volumul
