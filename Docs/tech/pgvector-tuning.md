# pgvector HNSW Tuning Guide

## Scope

This document defines the HNSW tuning strategy for pgvector, including runtime
ef_search selection, maintenance cadence, and validation targets.

## Current Parameters

- Index type: HNSW (vector_cosine_ops)
- prod_embeddings: m=32, ef_construction=128
- shop_product_embeddings: m=24, ef_construction=128
- prod_attr_definitions: m=16, ef_construction=64

These values are tuned for 1M+ vectors in prod_embeddings and lower cardinality
for attributes.

## Runtime ef_search Strategy

Use a dynamic ef_search based on the query limit:

- ef_search = clamp(limit \* 2, min=40, max=200)
- Example: limit=20 -> ef_search=40
- Example: limit=50 -> ef_search=100

This keeps recall high while controlling latency. For higher recall, raise
ef_search to 120-200 only when needed and confirm p95 latency.

## Maintenance

HNSW requires periodic VACUUM/ANALYZE to keep planner statistics accurate.

Recommended weekly job (off-peak):

```
VACUUM ANALYZE shop_product_embeddings;
VACUUM ANALYZE prod_embeddings;
VACUUM ANALYZE prod_attr_definitions;
```

Do not REINDEX HNSW routinely. Use REINDEX CONCURRENTLY only for corruption or
major regressions.

## Guardrails

- maintenance_work_mem: increase during bulk index build (outside app runtime)
- max_parallel_maintenance_workers: tune for faster index build if needed
- Keep ef_search bounded to prevent p99 spikes

## Benchmarks / Targets

- Recall: > 98% for top-20 results
- Latency: p95 < 50ms for 100 concurrent queries
- EXPLAIN ANALYZE must show HNSW index scan for vector queries

## Validation Checklist

1. Run EXPLAIN ANALYZE on vector search query and confirm index usage.
2. Compare recall between ef_search 40/80/120.
3. Track latency histogram and verify p95 < 50ms.
4. Confirm cache hit rate for hot queries.
