# SRE Performance Report - Neanelu Shopify Enterprise

> **Test Date:** [Înainte de Producție - Se va completa]
> **Test Environment:** Staging (bare-metal equivalent)
> **Last Updated:** 2025-12-26

---

## 1. Executive Summary

| Metric | Baseline Estimate | Notes |
| ------ | ----------------- | ----- |
| **Test Duration** | 4-6 ore | Include toate scenariile |
| **SKU Count** | 10,000 mock products | Generare cu Faker.js |
| **Overall Target** | All metrics within thresholds | |
| **Production Ready Criteria** | 100% scenarios PASS | |

---

## 2. Baseline Estimates & Targets

> **NOTĂ (AUDIT 2025-12-26):** Aceste valori sunt estimări bazate pe arhitectura definită și vor fi validate în testele reale. Valorile actuale se vor completa după executarea testelor.

### 2.1 Bulk Ingest (10K Products)

| Metric | Target | Baseline Estimate | Threshold ALERT | Justification |
| ------ | ------ | ----------------- | --------------- | ------------- |
| Total time | < 5 min | ~3-4 min | > 7 min | COPY + streaming |
| Ingest rate | > 50 prod/sec | ~60-80 prod/sec | < 30 prod/sec | pg COPY efficiency |
| Memory peak | < 512MB | ~300-400MB | > 800MB | Streaming, no buffering |
| Errors | 0 | 0 expected | > 0 = investigate | Retry logic built-in |
| DB connections | ≤ 20 | ~10-15 | > 30 | Pool sizing |

**Factori Critici:**

- JSONL streaming elimină memory spikes
- `COPY FROM STDIN` cu `pg-copy-streams` = bulk insert eficient
- Batch size: 1000 produse per chunk

**Riscuri Identificate:**

- Variante cu multe atribute JSONB pot încetini parsing-ul
- Index updates pe `shopify_products` după INSERT

---

### 2.2 Webhook Storm (1000/min)

| Metric | Target | Baseline Estimate | Threshold ALERT | Justification |
| ------ | ------ | ----------------- | --------------- | ------------- |
| Throughput | 1000/min | ~1200/min capacity | < 800/min | BullMQ Pro |
| Latency p50 | < 50ms | ~20-30ms | > 100ms | Memory queue |
| Latency p99 | < 200ms | ~100-150ms | > 500ms | With DB write |
| Queue backlog | < 1000 | ~200-500 | > 5000 | Steady state |
| Dropped webhooks | 0 | 0 | > 0 | Must not drop |

**Factori Critici:**

- BullMQ Pro cu Redis 8.4 = high throughput
- HMAC validation înainte de queue = respinge rapid invalid
- Worker concurrency: 10 per instanță

**Riscuri Identificate:**

- Webhook burst > 2000/min poate cauza backlog
- Redis memory spike dacă backlog crește

---

### 2.3 Rate Limiting (429 Response Handling)

| Metric | Target | Baseline Estimate | Threshold ALERT | Justification |
| ------ | ------ | ----------------- | --------------- | ------------- |
| Backoff trigger | 100% detected | 100% | < 100% = bug | Explicit check |
| Retry success | 100% eventual | 100% | < 95% = issue | Exponential backoff |
| Cascade prevention | No cascade | Isolated per shop | Any cascade | Group isolation |
| Cost budget tracking | Accurate | ±5% variance | > 10% drift | Lua script atomic |

**Algoritm Backoff:**

```text
Base delay: 1s
Max delay: 60s
Jitter: ±20%
Formula: min(60, 1 * 2^attempt) + random_jitter
```

**Riscuri Identificate:**

- Shopify poate schimba rate limits fără avertizare
- Bulk operations au limite separate (1 per shop)

---

### 2.4 Multi-tenant Fairness (BullMQ Pro Groups)

| Metric | Target | Baseline Estimate | Threshold ALERT | Justification |
| ------ | ------ | ----------------- | --------------- | ------------- |
| High-volume shop (Shop A) | No monopoly (max 40% capacity) | ~35% | > 50% | Group limits |
| Medium shop (Shop B) | Fair share (~30%) | ~30% | < 15% or > 45% | Proportional |
| Low-volume shop (Shop C) | Not starved (~30%) | ~35% | < 20% | Priority boost |
| Processing variance | < 20% between shops | ~10-15% | > 30% | Fair scheduling |

**Test Setup:**

- Shop A: 5000 produse (50% volume)
- Shop B: 3000 produse (30% volume)
- Shop C: 2000 produse (20% volume)

**Verificare:**

- Toate shop-urile finalizează în < 2x timp față de cota lor
- Nu există shop blocat > 30s

---

### 2.5 Memory Stability (Long-running - 2h soak test)

| Metric | Target | Baseline Estimate | Threshold ALERT | Justification |
| ------ | ------ | ----------------- | --------------- | ------------- |
| Worker initial memory | ~150MB | ~120-180MB | > 300MB | Node.js baseline |
| Worker peak memory | < 512MB | ~350-450MB | > 800MB | Processing spike |
| Worker steady state | < 300MB | ~200-280MB | > 400MB | After GC |
| Memory growth/hour | < 10MB/h | ~5MB/h | > 20MB/h = leak | Must stabilize |
| GC pause p99 | < 100ms | ~50-80ms | > 200ms | UX impact |

**Monitoring Points:**

- RSS (Resident Set Size)
- Heap Used vs Heap Total
- External Memory (Buffers)
- GC frequency și duration

**Riscuri Identificate:**

- Event listeners neatașate = memory leak
- Large JSONB parsing fără streaming

---

### 2.6 Database Performance

| Metric | Target | Baseline Estimate | Threshold ALERT | Justification |
| ------ | ------ | ----------------- | --------------- | ------------- |
| Query latency p50 | < 5ms | ~2-3ms | > 10ms | Simple queries |
| Query latency p95 | < 20ms | ~10-15ms | > 50ms | Complex joins |
| Query latency p99 | < 50ms | ~25-40ms | > 100ms | Heavy queries |
| Connection pool util | < 80% | ~50-60% | > 90% | Headroom |
| Slow queries (>100ms) | 0 | < 5/hour | > 10/hour | Investigation |

**Indexuri Critice Verificate:**

- `idx_products_shop_id` - RLS lookup
- `idx_products_shopify_id` - Sync upsert
- `idx_bulk_ops_status` - Queue polling

---

### 2.7 Vector Search Performance (pgvector)

| Metric | Target | Baseline Estimate | Threshold ALERT | Justification |
| ------ | ------ | ----------------- | --------------- | ------------- |
| Embedding storage | < 1GB for 10K | ~600-800MB | > 1.5GB | 1536 dims × 10K |
| Search latency p50 | < 50ms | ~20-30ms | > 100ms | HNSW index |
| Search latency p99 | < 200ms | ~100-150ms | > 500ms | With filtering |
| Index build time | < 5min for 10K | ~2-3min | > 10min | Initial load |
| Accuracy (recall@10) | > 95% | ~97% | < 90% | Quality check |

**Configurare HNSW:**

```sql
CREATE INDEX USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

---

## 3. Tool Recommendations

### 3.1 Load Testing Tools

| Tool | Use Case | Command Example |
| ---- | -------- | --------------- |
| **k6** | HTTP load testing, webhooks | `k6 run --vus 50 --duration 5m webhook-storm.js` |
| **Artillery** | Complex scenarios, async | `artillery run multi-tenant.yml` |
| **pgbench** | Database-only stress | `pgbench -c 20 -T 300 neanelu_shopify` |

### 3.2 k6 Script Template

```javascript
// tests/load/webhook-storm.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '1m', target: 50 },   // Ramp up
    { duration: '5m', target: 100 },  // Sustain 1000/min
    { duration: '1m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(99)<200'],
    errors: ['rate<0.01'],
  },
};

export default function () {
  const payload = JSON.stringify({
    id: Math.floor(Math.random() * 1000000),
    title: 'Test Product',
    updated_at: new Date().toISOString(),
  });

  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Topic': 'products/update',
    'X-Shopify-Hmac-Sha256': computeHmac(payload),
    'X-Shopify-Shop-Domain': 'test-shop.myshopify.com',
  };

  const res = http.post('http://localhost:65000/webhooks/products', payload, { headers });
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 200ms': (r) => r.timings.duration < 200,
  });
  
  errorRate.add(res.status !== 200);
  sleep(0.1);
}
```

### 3.3 Artillery Config Template

```yaml
# tests/load/multi-tenant.yml
config:
  target: "http://localhost:65000"
  phases:
    - duration: 60
      arrivalRate: 10
      name: "Warm up"
    - duration: 300
      arrivalRate: 50
      name: "Sustained load"
  plugins:
    expect: {}

scenarios:
  - name: "Shop A (high volume)"
    weight: 50
    flow:
      - post:
          url: "/webhooks/products"
          headers:
            X-Shopify-Shop-Domain: "shop-a.myshopify.com"
          json:
            id: "{{ $randomNumber(1, 100000) }}"
            title: "Product A"
          expect:
            - statusCode: 200

  - name: "Shop B (medium)"
    weight: 30
    flow:
      - post:
          url: "/webhooks/products"
          headers:
            X-Shopify-Shop-Domain: "shop-b.myshopify.com"
          json:
            id: "{{ $randomNumber(1, 100000) }}"
            title: "Product B"

  - name: "Shop C (low)"
    weight: 20
    flow:
      - post:
          url: "/webhooks/products"
          headers:
            X-Shopify-Shop-Domain: "shop-c.myshopify.com"
          json:
            id: "{{ $randomNumber(1, 100000) }}"
            title: "Product C"
```

---

## 4. Pre-Test Checklist

- [ ] Test environment matches production specs
- [ ] Database seeded with 10K mock products
- [ ] Redis cleared (`FLUSHALL` pe test env)
- [ ] Monitoring dashboards configured
- [ ] Alerting temporarily disabled (evită noise)
- [ ] Baseline metrics captured (idle state)
- [ ] Test scripts validated (dry run)
- [ ] Team notified about test window

---

## 5. Test Execution Order

1. **Idle Baseline** (5 min) - Capture system at rest
2. **Bulk Ingest** (10 min) - Full 10K import
3. **Webhook Storm** (10 min) - 1000/min sustained
4. **Multi-tenant Fairness** (15 min) - 3 shops competing
5. **Rate Limiting** (5 min) - Force 429s
6. **Soak Test** (2 hours) - Low steady load, watch memory
7. **Vector Search** (10 min) - Query performance

---

## 6. Post-Test Actions

### 6.1 Data Collection

- Export Prometheus metrics (tsdb snapshot)
- Export Grafana dashboard snapshots
- Collect worker logs cu traceIds
- Dump slow query log

### 6.2 Analysis Checklist

- [ ] All metrics within thresholds?
- [ ] Any error spikes? Investigate root cause
- [ ] Memory trend stable?
- [ ] Queue backlogs recovered?
- [ ] Any unexpected bottlenecks?

### 6.3 Sign-off Requirements

| Role | Responsibility | Sign-off |
| ---- | -------------- | -------- |
| SRE Lead | Infrastructure metrics | [ ] |
| Dev Lead | Application behavior | [ ] |
| Product Owner | Business SLOs | [ ] |

---

## 7. Extrapolation to 1M+ SKU

| Operation | 10K Estimate | 100K Extrapolated | 1M Extrapolated | Confidence |
| --------- | ------------ | ----------------- | --------------- | ---------- |
| Full sync | ~4 min | ~40 min | ~6-8 hours | Medium |
| Daily delta | ~10 sec | ~2 min | ~20 min | High |
| Memory (worker) | ~350MB | ~400MB | ~500MB | High (streaming) |
| Memory (PG) | ~1GB | ~10GB | ~100GB | Medium |
| Vector index size | ~800MB | ~8GB | ~80GB | High (linear) |
| Search latency | ~30ms | ~50ms | ~100ms | Medium |

> **ATENȚIE:** Extrapolările sunt estimări. La 1M+ SKU:
>
> - Poate fi necesar sharding PostgreSQL
> - pgvector poate necesita tuning HNSW (m, ef_construction)
> - Consider partitioning pe shop_id pentru tabele mari

---

## Appendix A: Test Environment Specification

```yaml
Infrastructure:
  PostgreSQL: 
    Version: 18.1 (with pgvector 0.7)
    Resources: 32GB RAM, 8 cores, NVMe SSD
    Config: shared_buffers=8GB, work_mem=256MB
    
  Redis: 
    Version: 8.4.0
    Resources: 16GB RAM
    Config: maxmemory=12gb, maxmemory-policy=allkeys-lru
    
  Workers: 
    Count: 2 instances
    Resources: 16GB RAM, 4 cores each
    Node.js: v24 LTS with --max-old-space-size=4096
    
Test Data:
  Products: 10,000 (generated with Faker.js)
  Variants: ~30,000 (3 per product average)
  Shops: 3 (multi-tenant testing)
  Embeddings: 10,000 vectors @ 1536 dimensions
  
Tools:
  Load Testing: k6 v0.50+
  Scenarios: Artillery v2.0+
  Monitoring: Prometheus + Grafana
  Profiling: Node.js --inspect, clinic.js
  Database: pgbench, pg_stat_statements
```

## Appendix B: Test Scripts Location

```text
tests/
├── load/
│   ├── bulk-ingest.js          # k6 - Bulk ingest stress
│   ├── webhook-storm.js        # k6 - Webhook throughput
│   ├── multi-tenant.yml        # Artillery - Fairness test
│   └── vector-search.js        # k6 - pgvector queries
├── soak/
│   └── memory-stability.js     # 2h memory leak detection
└── scripts/
    ├── generate-mock-data.ts   # Faker.js product generator
    ├── mock-shopify-bulk.ts    # Mock Shopify JSONL responses
    └── compute-hmac.ts         # Webhook signature helper
```

---

> **Document completat conform AUDIT 2025-12-26 (P2-3.6)**
