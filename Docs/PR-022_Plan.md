# PR-022 Plan (F4.2.1–F4.2.6) — `pr/F4.2-groups-fairness`

> Scop: implementare fairness multi-tenant (BullMQ Pro Groups) + prioritizare minimă + RLS enforcement în job processing, **100% ancorat în repo** (Plan_de_implementare + Docs + cod + typings BullMQ Pro instalate).

## Scope (din Plan_de_implementare)

PR-022 acoperă task-urile:

- **F4.2.1** Implementare Groups fairness (round-robin între shops)
- **F4.2.2** Cheie de grup (groupId) standard + validare/canonicalizare
- **F4.2.3** Config centralizat pentru limite (nu hardcode)
- **F4.2.4** Wrapper obligatoriu de shop context pentru job processing (RLS enforcement)
- **F4.2.5** Prioritizare minimă pentru tipuri de job (critical vs bulk)
- **F4.2.6** Test automat fairness/no-starvation

Sursa exactă: [Plan_de_implementare.md](../Plan_de_implementare.md) secțiunea **F4.2**.

## Reality check (API BullMQ Pro instalat, fără presupuneri)

În repo este instalat `@taskforcesh/bullmq-pro@7.41.0`.

### Groups / fairness (fapte din typings)

- **Group assignment este per-job**: `QueuePro.add(..., opts)` acceptă `opts.group?: { id: string }`.
- **Controls per worker**: `WorkerProOptions` expune controlul de Groups prin `workerOptions.group.concurrency` (per-group concurrency).
- Forma din plan `limiter: { max, groupKey }` NU există ca atare în API-ul instalat; echivalentul practic pentru fairness multi-tenant este:
  - per-job `group: { id }`
  - per-worker `workerOptions.group.concurrency`

## Decizii implicite (recomandate) pentru PR-022

1. **`groupId = shop_id` (UUID) și se setează în `job.opts.group.id`.** Asta aliniază cu planul și cu BullMQ Pro API real.
2. **Obținerea `shop_id` la enqueue: DB lookup cu cache in-process + timeout strict.** Motivație: contractul actual webhook payload nu conține shopId; nu introducem store extern nou; menținem ingress rapid și determinist.
3. **Prioritizare prin `priority` per job** (BullMQ standard) + Groups fairness prin `groupConcurrency`.
   - Prioritatea nu devine “escape hatch” global; fairness rămâne garantată între grupuri.

## Pre-req: cod existent relevant (hotspots)

- Ingress webhook: [apps/backend-worker/src/routes/webhooks.ts](../apps/backend-worker/src/routes/webhooks.ts)
- Producer webhook: [packages/queue-manager/src/webhooks.ts](../packages/queue-manager/src/webhooks.ts)
- Worker factory: [packages/queue-manager/src/queue-manager.ts](../packages/queue-manager/src/queue-manager.ts)
- Worker webhook: [apps/backend-worker/src/processors/webhooks/worker.ts](../apps/backend-worker/src/processors/webhooks/worker.ts)
- RLS wrapper: [packages/database/src/db.ts](../packages/database/src/db.ts) (exportat via [packages/database/src/index.ts](../packages/database/src/index.ts))
- RLS test cases: [Docs/Testing_RLS_Isolation.md](Testing_RLS_Isolation.md)
- Integration tests queue-manager: [packages/queue-manager/src/__tests__/queue-manager.integration.test.ts](../packages/queue-manager/src/__tests__/queue-manager.integration.test.ts)

---

## F4.2.1 — Groups fairness (round-robin între shops)

### Cerință (din plan)

- “Round-robin între grupuri (fără starvation)”
- “Limitare concurență per shop”
- “Concurență globală: MAX_GLOBAL_CONCURRENCY”

### Implementare (repo-grounded)

- Introducem un “fairness defaults” layer în `@app/queue-manager`:
  - Worker-side: setăm `workerOptions.group.concurrency` (per shop) și `concurrency` (global) prin `WorkerProOptions` în `createWorker`.
  - Job-side: setăm `group: { id: shopId }` în `queue.add(...)` pentru job-urile care trebuie fairness.

### Validare (din plan)

- Două shops cu backlog mare → procesare intercalată echitabil (nu secvențial).

### Validare (automatizată în F4.2.6)

- Test determinist de fairness/no-starvation în suite-ul `queue-manager (integration)`.

---

## F4.2.2 — groupId standard + validare/canonicalizare

### Cerință (din plan) F4.2.2

- Standard: `groupId = shop_id` (UUID canonical)
- Job fără shop valid e respins înainte de enqueue

### Implementare (repo-grounded) F4.2.2

- Extindem contractul `WebhookJobPayload` cu `shopId?: string` (opțional pentru compat), dar **enforce** la enqueue: dacă lipsește sau nu e UUID → nu enqueue.
- În webhook ingress:
  - rezolvăm `shopId` prin DB lookup după `shopDomain`.
  - folosim cache in-process (TTL) pentru a evita query la fiecare webhook.
  - timeout strict (ex. 150ms) pentru a păstra ingress rapid; la timeout → 503 (Shopify retry).

### Validare (din plan) F4.2.2

- Job cu shopId invalid e respins înainte de enqueue.

---

## F4.2.3 — Config centralizat pentru limite (nu hardcode)

### Cerință (din plan) F4.2.3

- Env vars:
  - `MAX_ACTIVE_PER_SHOP` (default 2)
  - `MAX_GLOBAL_CONCURRENCY` (default 50)
  - `STARVATION_TIMEOUT_MS` (default 60000)

### Implementare (repo-grounded) F4.2.3

- Adăugăm aceste variabile în contractul de env din `@app/config` (tipul `AppEnv` + `loadEnv`).
- `@app/queue-manager` consumă valorile ca defaults când creează worker-e (fără hardcode).

### Validare (din plan) F4.2.3

- Modifici limitele doar din env → se schimbă comportamentul fără code changes.

---

## F4.2.4 — Wrapper obligatoriu de shop context (RLS enforcement)

### Cerință (din plan) F4.2.4

- Orice processor cu DB rulează cu shop context setat.
- Interzis: query DB fără `SET LOCAL`.

### Implementare (repo-grounded) F4.2.4

- Pentru job-urile multi-tenant (începem cu webhook worker): folosim `withTenantContext(shopId, fn)` din `@app/database`.
- Update processors să folosească `job.data.shopId` ca sursă de adevăr (nu re-lookup) și să nu execute query în afara contextului.

### Validare (din plan) F4.2.4

- Test integrare: job shop A urmat de job shop B pe același worker → zero leak cross-tenant.

### Validare (aliniată Docs)

- Folosim cazurile din [Docs/Testing_RLS_Isolation.md](Testing_RLS_Isolation.md) ca referință pentru ce înseamnă “zero leak”.

---

## F4.2.5 — Prioritizare minimă (critical vs bulk)

### Cerință (din plan) F4.2.5

- priority 1: CRITICAL (app/uninstalled, auth events)
- priority 5: NORMAL (webhooks standard)
- priority 10: BULK (sync/ingest masiv)

### Implementare (repo-grounded) F4.2.5

- În producer-ul webhook setăm `priority` în `queue.add` în funcție de topic:
  - `app/uninstalled` → 1
  - rest webhook topics → 5
- Pentru bulk queues (care vin în sprint-uri ulterioare), stabilim utilitar comun în queue-manager (export) pentru a evita “magic numbers” dispersate.

### Validare (din plan) F4.2.5

- Job critical se procesează înaintea backlog-ului bulk.

### Validare (automatizată)

- Test de integrare: bulk backlog + job critical (același group) → critical finalizează înainte de ultimul bulk.

---

## F4.2.6 — Test automat fairness/no-starvation

### Cerință (din plan) F4.2.6

- Injectează N job-uri în 2 grupuri (shopA: 100, shopB: 10)
- Verifică intercalare (shopB nu așteaptă 100 job-uri)
- Test determinist; rulează în CI.

### Implementare (repo-grounded) F4.2.6

- Adăugăm un test în `packages/queue-manager/src/__tests__/queue-manager.integration.test.ts` care:
  - creează queue + worker cu `groupConcurrency=1` și `concurrency=2` (controlat)
  - enqueues jobs cu `group: { id: shopA }` și `group: { id: shopB }`
  - verifică: primul job din shopB apare în primele K completări și/sau înainte de `STARVATION_TIMEOUT_MS`.

---

## Definition of done (PR-022)

- Env contract include variabilele F4.2.3 cu default-uri.
- Jobs relevante setează `group.id = shopId`.
- Worker-e folosesc `groupConcurrency` (per shop) + `concurrency` (global).
- Webhook worker rulează DB work doar sub `withTenantContext` folosind `job.data.shopId`.
- Priorități setate pentru webhook critical vs normal.
- Testele F4.2.6 sunt deterministe și CI verde (`pnpm -w run ci`).
