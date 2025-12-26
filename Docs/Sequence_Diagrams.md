# Sequence Diagrams - Neanelu Shopify Enterprise

> **Format:** Mermaid | **Version:** 1.0 | **Last Updated:** 2025-12-26

---

## 1. OAuth Installation Flow

```mermaid
sequenceDiagram
    participant M as Merchant
    participant S as Shopify
    participant B as Backend (Fastify)
    participant DB as PostgreSQL

    M->>S: Click "Install App"
    S->>B: GET /auth/start?shop=xxx.myshopify.com
    B->>DB: INSERT oauth_states (state, nonce, shop)
    B->>S: Redirect to Shopify OAuth consent
    S->>M: Show permissions screen
    M->>S: Approve scopes
    S->>B: GET /auth/callback?code=xxx&state=yyy
    B->>DB: SELECT oauth_states WHERE state=yyy
    B->>B: Validate state + nonce
    B->>S: POST /admin/oauth/access_token
    S->>B: Return access_token
    B->>B: Encrypt token (AES-256-GCM)
    B->>DB: INSERT shops (token_ciphertext, scopes)
    B->>S: Redirect to app embed
    S->>M: Show embedded app
```

---

## 2. Webhook Processing Pipeline

```mermaid
sequenceDiagram
    participant S as Shopify
    participant H as HTTP Handler
    participant R as Redis Queue
    participant W as Worker
    participant DB as PostgreSQL

    S->>H: POST /api/webhooks (HMAC signed)
    H->>H: Verify HMAC (constant-time)
    H->>H: Extract topic + shop_id
    H->>R: enqueue(webhook-queue, payload)
    H->>S: 200 OK (fast response)
    
    Note over R,W: Async processing
    
    R->>W: Dequeue job (BullMQ Groups)
    W->>W: SET app.current_shop_id (RLS)
    W->>DB: Process webhook (INSERT/UPDATE)
    W->>R: Mark job complete
    
    alt Job Failed
        W->>R: Retry with backoff
    end
```

---

## 3. Bulk Operations Pipeline (1M+ Products)

```mermaid
sequenceDiagram
    participant A as API/Cron
    participant B as Backend
    participant S as Shopify
    participant R as Redis
    participant DB as PostgreSQL

    A->>B: Trigger bulk sync
    B->>R: Acquire distributed lock (shopId)
    B->>DB: INSERT bulk_runs (status=pending)
    B->>S: bulkOperationRunQuery (GraphQL)
    S->>B: Return operation_id
    B->>DB: UPDATE bulk_runs (status=running)
    
    loop Polling (every 30s)
        B->>S: Query bulk operation status
        S->>B: Return status + url
    end
    
    S->>B: Status=COMPLETED, result_url
    B->>S: Stream JSONL (fetch)
    
    Note over B: Stream processing
    
    B->>B: Parse JSONL lines
    B->>B: Stitch __parentId relations
    B->>B: Transform to schema
    B->>DB: COPY FROM STDIN (pg-copy-streams)
    B->>DB: UPDATE bulk_runs (status=completed)
    B->>R: Release lock
```

---

## 4. AI Embedding Batch Flow

```mermaid
sequenceDiagram
    participant C as Cron Job
    participant B as Backend
    participant DB as PostgreSQL
    participant O as OpenAI Batch API
    participant R as Redis

    C->>B: Trigger embedding job
    B->>DB: SELECT products WHERE embedding_at IS NULL
    B->>B: Generate JSONL batch file
    B->>O: POST /v1/batches (upload JSONL)
    O->>B: Return batch_id
    B->>DB: INSERT ai_batches (status=processing)
    
    Note over O: Async processing (up to 24h)
    
    loop Polling (every 1h)
        B->>O: GET /v1/batches/{id}
        O->>B: Return status
    end
    
    O->>B: Status=completed
    B->>O: GET results JSONL
    B->>B: Parse embeddings
    B->>DB: INSERT prod_embeddings (vectors)
    B->>R: HSET vectors for search cache
    B->>DB: UPDATE ai_batches (status=completed)
```

---

## 5. Rate Limiting Flow (Shopify GraphQL)

```mermaid
sequenceDiagram
    participant W as Worker
    participant R as Redis
    participant S as Shopify API

    W->>R: GET bucket:{shopId}:available
    
    alt Sufficient budget
        R->>W: available >= costNeeded
        W->>S: GraphQL query
        S->>W: Response + throttleStatus
        W->>R: DECRBY bucket:{shopId} costActual
    else Insufficient budget
        R->>W: available < costNeeded
        W->>R: GET restoreRate
        W->>W: Calculate delay
        W->>W: await delay(ms)
        W->>S: GraphQL query (retry)
    end
    
    Note over R: Background restore
    R->>R: INCRBY bucket every second
```

---

## 6. Multi-tenant RLS Context Flow

```mermaid
sequenceDiagram
    participant R as HTTP Request
    participant M as Middleware
    participant DB as PostgreSQL Pool
    participant T as Transaction

    R->>M: Request with shop context
    M->>M: Extract shopId from JWT/session
    M->>DB: Get connection from pool
    DB->>T: BEGIN
    T->>T: SET LOCAL app.current_shop_id = $shopId::uuid
    T->>T: Execute queries (RLS enforced)
    T->>DB: COMMIT/ROLLBACK
    DB->>DB: Return connection to pool
    
    Note over DB: Connection reset on return
    DB->>DB: RESET app.current_shop_id
```

---

## Legend

| Symbol | Meaning |
| ------ | ------- |
| ─────► | Synchronous call |
| ─ ─ ─► | Async/background |
| █████ | Database storage |
| ░░░░░ | Cache/queue |
