# Runbook: AI Pipeline Operations

> **Scope:** OpenAI embeddings, pgvector search, Redis cache
> **Owner:** Backend Team
> **Last Updated:** 2026-02-01

## Simptome

- Alert: `ai_backlog_items > 10000`
- Alert: `ai_batch_age_seconds > 7200` (batch blocat >2h)
- Queue `ai-batch-queue` stalled in dashboard
- Vector search latency p95 > 300ms

## Cauze Posibile

1. OpenAI API down / rate limited
2. Postgres connection pool exhausted
3. Redis unavailable
4. Backfill job stuck in loop
5. HNSW index degraded or corrupted

## Diagnoza Rapida

```bash
# Verificare status servicii
docker compose ps

# Verificare logs AI worker
docker compose logs --tail 200 backend-worker 2>&1 | grep -i "ai\|embed\|batch"

# Verificare queue status
curl -s http://localhost:65001/api/queues | jq '.[] | select(.name | contains("ai"))'

# Verificare metrici
curl -s http://localhost:65024/metrics | grep -E "ai_|vector_search"
```

## Oprire Pipeline AI

### Optiunea A: Kill Switch (fara redeploy)

```bash
# 1. Seteaza env var
export OPENAI_EMBEDDING_BACKFILL_ENABLED=false

# 2. Restart worker
docker compose restart backend-worker

# 3. Verificare
docker compose logs backend-worker | grep "backfill.*disabled"
```

### Optiunea B: Pause Queue (temporar)

```bash
# Pause queue
curl -X POST http://localhost:65001/api/queues/ai-batch-queue/pause

# Resume cand gata
curl -X POST http://localhost:65001/api/queues/ai-batch-queue/resume
```

### Optiunea C: Stop Worker Complet

```bash
docker compose stop backend-worker
```

## Investigare Backlog

### SQL Queries

```sql
-- Backlog per shop
SELECT shop_id, status, COUNT(*) AS count
FROM shop_product_embeddings
GROUP BY shop_id, status
ORDER BY count DESC;

-- Batch-uri stuck (>2h)
SELECT id, shop_id, status, total_items, completed_items,
       now() - submitted_at AS age
FROM embedding_batches
WHERE status IN ('submitted', 'processing')
  AND submitted_at < now() - interval '2 hours';

-- Top 10 shops cu backlog
SELECT shop_id, COUNT(*) AS pending
FROM shop_product_embeddings
WHERE status = 'pending'
GROUP BY shop_id
ORDER BY pending DESC
LIMIT 10;

-- Erori recente
SELECT error_message, COUNT(*) AS count
FROM shop_product_embeddings
WHERE status = 'failed'
  AND updated_at > now() - interval '1 hour'
GROUP BY error_message
ORDER BY count DESC;
```

## Reindexare Embeddings

### Full Reindex (toate produsele unui shop)

```sql
-- ATENTIE: Operatie costisitoare! Doar cand necesar.
UPDATE shop_product_embeddings
SET status = 'pending', retry_count = 0
WHERE shop_id = 'UUID-SHOP-ID';
```

### Reindex produse failed

```sql
UPDATE shop_product_embeddings
SET status = 'pending', retry_count = 0
WHERE status = 'failed' AND retry_count < 3;
```

### VACUUM HNSW Index

```sql
-- Ruleaza off-peak (weekend noapte)
VACUUM ANALYZE shop_product_embeddings;
VACUUM ANALYZE embedding_batches;
```

### REINDEX (doar pentru coruptie severa)

```sql
-- ATENTIE: Blocheaza write-uri! Foloseste CONCURRENTLY.
REINDEX INDEX CONCURRENTLY idx_shop_embeddings_vector;
```

## Verificare Post-Remediere

- Queue proceseaza job-uri: `curl http://localhost:65001/api/queues`
- Metrici normale: `ai_backlog_items < 1000`
- Latenta OK: `vector_search_latency_seconds p95 < 0.3`
- Logs fara erori: `docker compose logs backend-worker | grep -i error`

## Escalare

1. Contacteaza @backend-team pe Slack
2. Verifica status OpenAI: `https://status.openai.com`
3. Colecteaza logs: `docker compose logs > ai-incident-$(date +%Y%m%d%H%M).log`
