# API Specification - NEANELU Shopify Manager

> **Versiune:** 1.0 | **API Version:** 2025-10 | **Data:** 2025-12-26

---

## Convenții Generale

### Base URL

- **Development:** `http://localhost:65000/api`
- **Production:** `https://manager.neanelu.ro/api`

> **Notă:** Webhook-urile sunt expuse la `/webhooks/:topic`, NU sub prefixul `/api/`. Vezi secțiunea [3. Webhook Endpoints](#3-webhook-endpoints).
>
> Pentru codurile de eroare complete, consultă [Error_Codes_Reference.md](./Error_Codes_Reference.md).

### Authentication

Toate endpoint-urile (cu excepția OAuth și health) necesită autentificare:

- **Header:** `Authorization: Bearer <session_token>`
- **Session cookie:** `neanelu_session` (pentru embedded apps)

### Response Format

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "request_id": "uuid",
    "timestamp": "ISO8601"
  }
}
```

### Error Format

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": { ... }
  },
  "meta": {
    "request_id": "uuid",
    "timestamp": "ISO8601"
  }
}
```

---

## 1. Health Endpoints

### GET /health/live

Kubernetes liveness probe.

**Response:** `200 OK`

```json
{ "status": "alive" }
```

### GET /health/ready

Kubernetes readiness probe - checks DB and Redis connectivity.

`checks.shopify_api` este **config-valid** (prezență + formate variabile env Shopify) și nu necesită OAuth/token.

**Response:** `200 OK` sau `503 Service Unavailable`

```json
{
  "status": "ready",
  "checks": {
    "database": "ok",
    "redis": "ok",
    "shopify_api": "ok"
  }
}
```

---

## 2. OAuth Endpoints

### GET /auth/shopify

Inițializează OAuth flow pentru instalare app.

**Query Parameters:**

| Param | Type   | Required | Description                              |
| ----- | ------ | -------- | ---------------------------------------- |
| shop  | string | Yes      | Shopify domain (ex: store.myshopify.com) |

**Response:** `302 Redirect` to Shopify OAuth

### GET /auth/shopify/callback

Callback după autorizare Shopify.

**Query Parameters:**

| Param     | Type   | Description         |
| --------- | ------ | ------------------- |
| code      | string | Authorization code  |
| shop      | string | Shop domain         |
| hmac      | string | HMAC signature      |
| state     | string | CSRF state          |
| timestamp | string | Request timestamp   |

**Response:** `302 Redirect` to app dashboard

---

## 2.1 Session Token Helper (Web Admin)

> [!NOTE]
> Acest endpoint este folosit de UI (web-admin) pentru a obține un `Authorization: Bearer ...`
> atunci când există deja cookie auth (`neanelu_session`).

### GET /api/session/token

Returnează token-ul de sesiune și momentul expirării.

**Auth:** necesită cookie session (`neanelu_session`). Dacă nu există sesiune: `401`.

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "token": "<bearer token>",
    "expiresAt": "2026-01-08T14:06:44.243Z"
  },
  "meta": {
    "request_id": "uuid",
    "timestamp": "ISO8601"
  }
}
```

---

## 2.2 UI Profile (Multi-shop UX)

> [!NOTE]
> Endpoint de preferințe UI (fără secrete), cheiat de un cookie httpOnly (`neanelu_ui_profile`).
> Este intenționat **fără auth** pentru a permite UX în non-embedded / pre-auth.

### GET /api/ui-profile

Returnează profilul UI curent.

**Auth:** nu necesită `Authorization`.

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "activeShopDomain": "example.myshopify.com",
    "lastShopDomain": "example.myshopify.com",
    "recentShopDomains": ["example.myshopify.com"]
  },
  "meta": {
    "request_id": "uuid",
    "timestamp": "ISO8601"
  }
}
```

### POST /api/ui-profile

Actualizează câmpurile profile-ului (best-effort). Câmpurile omise nu resetează valorile existente.

**Request Body:**

```json
{
  "activeShopDomain": "example.myshopify.com",
  "lastShopDomain": "example.myshopify.com"
}
```

**Response:** `200 OK` (aceeași formă ca GET).

## 3. Webhook Endpoints

### POST /webhooks/:topic

Receiver pentru Shopify webhooks.

**Headers:**

- `X-Shopify-Topic`: Webhook topic
- `X-Shopify-Hmac-Sha256`: HMAC signature
- `X-Shopify-Shop-Domain`: Shop domain
- `X-Shopify-Webhook-Id`: Unique webhook ID

**Supported Topics:**

| Topic                | Queue            | Priority |
| -------------------- | ---------------- | -------- |
| `products/create`    | webhook-queue    | normal   |
| `products/update`    | webhook-queue    | normal   |
| `products/delete`    | webhook-queue    | high     |
| `collections/create` | webhook-queue    | normal   |
| `collections/update` | webhook-queue    | normal   |
| `orders/create`      | webhook-queue    | high     |
| `app/uninstalled`    | webhook-queue    | critical |
| `shop/update`        | webhook-queue    | normal   |

**Response:** `200 OK` (acknowledge receipt)

---

## 4. Bulk Operations

### POST /api/bulk/start

Inițializează o operațiune bulk (export/import).

**Request Body:**

```json
{
  "type": "export",
  "resource": "products",
  "query": "query { products { edges { node { id title } } } }",
  "filters": {
    "created_after": "2025-01-01T00:00:00Z"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "run_id": "uuid",
    "status": "PENDING",
    "estimated_records": 150000
  },
  "meta": {
    "request_id": "uuid",
    "timestamp": "ISO8601"
  }
}
```

### GET /api/bulk/:run_id

Verifică status operațiune bulk.

**Response:**

```json
{
  "success": true,
  "data": {
    "run_id": "uuid",
    "status": "PROCESSING",
    "progress": {
      "processed": 45000,
      "total": 150000,
      "percentage": 30
    },
    "started_at": "ISO8601",
    "estimated_completion": "ISO8601"
  },
  "meta": {
    "request_id": "uuid",
    "timestamp": "ISO8601"
  }
}
```

### DELETE /api/bulk/:run_id

Anulează operațiune bulk în curs.

---

## 5. Products API

### GET /api/products

Lista produse cu paginare.

**Query Parameters:**

| Param     | Type   | Default    | Description              |
| --------- | ------ | ---------- | ------------------------ |
| page      | int    | 1          | Page number              |
| limit     | int    | 50         | Items per page (max 250) |
| search    | string | -          | Full-text search         |
| status    | string | -          | Filter by status         |
| sortBy    | string | updated_at | Sort field               |
| sortOrder | string | desc       | asc/desc                 |

### GET /api/products/:id

Detalii produs individual.

### GET /api/products/search

Căutare vectorială semantică.

**Query Parameters:**

| Param     | Type   | Required | Description                       |
| --------- | ------ | -------- | --------------------------------- |
| q         | string | Yes      | Query text                        |
| limit     | int    | No       | Results limit (default 20)        |
| threshold | float  | No       | Similarity threshold (default 0.7)|

**Response:**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "uuid",
        "title": "Product Name",
        "similarity": 0.92,
        "highlights": ["matched text"]
      }
    ],
    "vectorSearchTime": "45ms"
  }
}
```

---

## 6. Queue Management

### GET /api/queues

Lista cozi și statistici.

**Response:**

```json
{
  "success": true,
  "data": {
    "queues": [
      {
        "name": "webhook-queue",
        "waiting": 150,
        "active": 5,
        "completed": 10000,
        "failed": 12
      }
    ]
  }
}
```

### POST /api/queues/:name/pause

Pune coada pe pauză.

### POST /api/queues/:name/resume

Reia procesarea cozii.

### DELETE /api/queues/:name/jobs/failed

Șterge job-urile eșuate.

---

## 7. AI Embeddings

### POST /api/ai/embed

Generează embeddings pentru text.

**Request Body:**

```json
{
  "texts": ["Product description 1", "Product description 2"],
  "model": "text-embedding-3-small"
}
```

### POST /api/ai/batch

Inițializează batch de embeddings pentru produse.

**Request Body:**

```json
{
  "productIds": ["uuid1", "uuid2"],
  "regenerate": false
}
```

---

## Rate Limiting

| Endpoint Pattern | Limit | Window |
| ---------------- | ----- | ------ |
| `/api/*`         | 100   | 1 min  |
| `/api/bulk/*`    | 10    | 1 min  |
| `/api/ai/*`      | 20    | 1 min  |
| `/webhooks/*`    | 1000  | 1 min  |

**Headers în Response:**

- `X-RateLimit-Limit`: Limita totală
- `X-RateLimit-Remaining`: Requests rămase
- `X-RateLimit-Reset`: Timestamp reset

---

## Versioning

API-ul folosește versioning prin header:

- `X-API-Version: 2025-10`

Fallback la 2025-07 dacă 2025-10 nu e disponibil.
