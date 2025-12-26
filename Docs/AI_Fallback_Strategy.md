# AI Fallback Strategy - NEANELU Shopify Manager

> **Versiune:** 1.0 | **Data:** 2025-12-26

---

## Overview

Această documentație descrie strategia de fallback pentru cazurile când
OpenAI API nu este disponibil sau returnează erori. Obiectivul este
**graceful degradation** - aplicația trebuie să rămână funcțională
chiar și fără componenta AI.

---

## Provider Principal: OpenAI

### Configurație Curentă

| Setting             | Value                    |
| ------------------- | ------------------------ |
| Model Embeddings    | `text-embedding-3-small` |
| Dimensiuni Vector   | 1536                     |
| Model Chat (future) | `gpt-4o-mini`            |
| Batch API           | Enabled                  |
| Rate Limit          | 10,000 RPM               |

### Monitorizare Health

```typescript
// Check OpenAI health periodically
async function checkOpenAIHealth(): Promise<boolean> {
  try {
    const response = await openai.models.list();
    return response.data.length > 0;
  } catch (error) {
    return false;
  }
}
```

---

## Failure Scenarios

### 1. Rate Limiting (429)

**Cauză:** Prea multe requests într-un interval scurt.

**Comportament:**

- Exponential backoff cu jitter
- Max 5 retry-uri
- Alert după 3 retry-uri consecutive

**Fallback:**

- Queue jobs for later
- Process in batches with delays

```typescript
const backoff = Math.min(1000 * 2 ** attempt, 60000) + Math.random() * 1000;
await sleep(backoff);
```

---

### 2. Quota Exceeded (402)

**Cauză:** Limita de billing depășită.

**Comportament:**

- Nu se mai fac requests la OpenAI
- Alert CRITICAL către admin
- Fallback to cached results

**Fallback:**

- Use existing embeddings only
- Disable new embedding generation
- Full-text search instead of semantic search

---

### 3. API Down (500/503)

**Cauză:** OpenAI service outage.

**Comportament:**

- Circuit breaker activation after 3 failures
- Retry with increasing delays
- Alert after 5 minutes of downtime

**Fallback:**

- Use cached embeddings
- Basic keyword search
- Queue embedding jobs for later

---

### 4. Network Timeout

**Cauză:** Network issues or high latency.

**Comportament:**

- 30s timeout per request
- Retry with different connection

**Fallback:**

- Queue for later processing

---

## Degradation Levels

### Level 0: Full Functionality ✅

- OpenAI fully operational
- Real-time embedding generation
- Semantic search active
- All AI features enabled

### Level 1: Delayed Processing ⚠️

- OpenAI responding slowly
- Embeddings generated in batch (delayed)
- Semantic search from cache only
- New products visible without AI enrichment

### Level 2: Cache-Only Mode 🔶

- OpenAI unavailable
- No new embeddings generated
- Semantic search only for indexed products
- Full-text search fallback active

### Level 3: AI Disabled 🔴

- Complete AI feature disable
- Full-text search only (PostgreSQL tsvector)
- Products visible without semantic features
- Manual enrichment possible

---

## Fallback Components

### 1. Semantic Search → Full-Text Search

**Normal Mode (AI):**

```typescript
SELECT * FROM products 
WHERE embedding <=> $1 < 0.3
ORDER BY embedding <=> $1
LIMIT 20;
```

**Fallback Mode (FTS):**

```typescript
SELECT * FROM products
WHERE search_vector @@ plainto_tsquery('english', $query)
ORDER BY ts_rank(search_vector, plainto_tsquery('english', $query)) DESC
LIMIT 20;
```

### 2. Product Enrichment → Raw Data

**Normal Mode:**

- AI-generated summaries
- Auto-extracted keywords
- Semantic categories

**Fallback Mode:**

- Raw Shopify descriptions
- Manual tags only
- No auto-categorization

### 3. Batch Processing → Deferred Queue

**Normal Mode:**

- Immediate embedding on product create/update
- 50 products per batch

**Fallback Mode:**

- Queue products for later processing
- Alert when queue > 1000 items
- Process when OpenAI recovers

---

## Circuit Breaker Configuration

```typescript
const circuitBreaker = {
  failureThreshold: 5,      // Failures before opening
  successThreshold: 2,       // Successes to close
  timeout: 60000,            // Time in open state (ms)
  halfOpenRequests: 3        // Test requests in half-open
};

// States:
// CLOSED: Normal operation
// OPEN: All requests fail fast
// HALF_OPEN: Testing recovery
```

---

## Alternative Providers (Future)

### Tier 2: Azure OpenAI

- Same models, different endpoint
- Requires separate deployment
- Configuration ready, not active

### Tier 3: Local Models (Future Consideration)

- Ollama with open-source models
- Higher latency, lower cost
- Privacy benefits
- Not production-ready

---

## Monitoring & Alerts

### Metrics

| Metric                       | Alert Threshold  | Severity |
| ---------------------------- | ---------------- | -------- |
| `openai_request_success_rate`| < 95% for 5min   | Warning  |
| `openai_request_success_rate`| < 80% for 5min   | Critical |
| `embedding_queue_size`       | > 1000           | Warning  |
| `embedding_queue_size`       | > 5000           | Critical |
| `circuit_breaker_state`      | OPEN             | Critical |

### Dashboards

- OpenAI API Response Times
- Embedding Generation Rate
- Circuit Breaker State Timeline
- Fallback Mode Active Duration

---

## Recovery Procedure

### Automatic Recovery

1. Circuit breaker detects successful responses
2. Moves to HALF_OPEN state
3. Processes test requests
4. Returns to CLOSED if tests pass
5. Drains queued embedding jobs

### Manual Recovery

1. **Verify OpenAI status:** <https://status.openai.com/>
2. **Check credentials:** Verify API key valid
3. **Check billing:** Ensure account in good standing
4. **Reset circuit breaker:** Admin endpoint `/api/admin/ai/reset`
5. **Process backlog:** Trigger batch processor

---

## Configuration

Environment variables:

```bash
# Primary Provider
OPENAI_API_KEY=sk-...
OPENAI_ORG_ID=org-...

# Fallback Settings
AI_FALLBACK_ENABLED=true
AI_CIRCUIT_BREAKER_ENABLED=true
AI_QUEUE_MAX_SIZE=10000

# Timeouts
AI_REQUEST_TIMEOUT_MS=30000
AI_BATCH_SIZE=50

# Alternative (future)
# AZURE_OPENAI_ENDPOINT=https://...
# AZURE_OPENAI_KEY=...
```

---

## Testing Fallback

### Manual Test

```bash
# Simulate OpenAI down
export OPENAI_SIMULATE_FAILURE=true
pnpm test:fallback

# Test search with and without AI
curl "http://localhost:65000/api/products/search?q=jacket"
```

### Integration Test

- Chaos engineering: Random API failures
- Load test: Verify queue handling
- Recovery test: Simulate full outage and recovery
