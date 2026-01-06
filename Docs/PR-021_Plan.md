# PR-021 Plan (F4.1.5–F4.1.8) — `pr/F4.1-refactor-enqueue`

> Scop: plan de implementare **100% ancorat în repo** (Plan + Docs + cod existent), fără presupuneri despre API-uri inexistente.

## Scope (din Plan_de_implementare)

- **F4.1.5** Refactor: mută enqueue-ul minim din F3 în `@app/queue-manager`.
- **F4.1.6** Worker lifecycle hardening (scheduler/events, stalled detection, graceful shutdown).
- **F4.1.7** Health/readiness pentru worker + verificări operaționale.
- **F4.1.8** Teste de integrare pentru `@app/queue-manager` (node:test), CI cu Redis ephemeral.

## Reality check (ce există deja în repo)

### Producer webhook (astăzi)

- Ingress: [apps/backend-worker/src/routes/webhooks.ts](../apps/backend-worker/src/routes/webhooks.ts)
  - Apelează `enqueueWebhookJob(jobPayload, request.log)`.
- Producer: [apps/backend-worker/src/queue/webhook-queue.ts](../apps/backend-worker/src/queue/webhook-queue.ts)
  - Deja folosește `@app/queue-manager` (`createQueue`, `configFromEnv`) și are `WEBHOOK_QUEUE_NAME`.

### Worker webhook (astăzi)

- Worker: [apps/backend-worker/src/processors/webhooks/worker.ts](../apps/backend-worker/src/processors/webhooks/worker.ts)
  - Folosește `@app/queue-manager` (`createWorker`, `createQueueEvents`), are listeners pentru `stalled`/`failed`.

### Health (astăzi)

- Endpoint-uri: [apps/backend-worker/src/http/server.ts](../apps/backend-worker/src/http/server.ts)
  - `/health/live` și `/health/ready` (DB + Redis + Shopify config).
  - Nu include status worker.

### Teste queue-manager (astăzi)

- `node:test` + `tsx`: [packages/queue-manager/package.json](../packages/queue-manager/package.json)
- Integrare existentă: [packages/queue-manager/src/__tests__/queue-manager.integration.test.ts](../packages/queue-manager/src/__tests__/queue-manager.integration.test.ts)
  - E2E queue+worker.
  - DLQ population.
- CI are Redis ephemeral deja: [ci-pr.yml](../.github/workflows/ci-pr.yml)

## Diferențe față de Plan (de tratat explicit în PR-021)

- Planul F3.3.3 menționează `enqueueWebhookJob(payload)` ca semnătură-contract. În codul actual, consumer-ul folosește **două argumente**: `enqueueWebhookJob(payload, logger)`.
  - În PR-021 tratăm contractul ca “semnătura efectiv folosită în repo” și păstrăm compatibilitatea (fără schimbări în semantica răspunsului webhook).
- Planul F4.1.7 menționează `/healthz`, dar Docs + cod folosesc `/health/live` și `/health/ready`.
  - În PR-021 extindem `/health/ready` (readiness) cu verificări operaționale ale worker-ilor, fără a introduce un endpoint nou public.

---

## F4.1.5 — Refactor: mută enqueue-ul minim din F3 în queue-manager

### Obiectiv
- Endpoint-ul webhook importă producer-ul din `@app/queue-manager` (nu din `apps/backend-worker/src/queue`).
- Eliminăm dublurile; păstrăm semantica “răspuns rapid” din ingress.

### Implementare (pași)
1. În `@app/queue-manager`, adaugă un modul dedicat webhook producer (ex: `packages/queue-manager/src/webhooks.ts` sau `src/producers/webhook.ts`).
2. Mută logica din [apps/backend-worker/src/queue/webhook-queue.ts](../apps/backend-worker/src/queue/webhook-queue.ts) în noul modul, inclusiv:
   - `WEBHOOK_QUEUE_NAME`
   - `enqueueWebhookJob(...)`
   - `closeWebhookQueue()` (pentru shutdown)
   - (opțional, dacă rămâne folosit) `cleanupWebhookJobsForShopDomain(...)`
3. Expune API-ul prin [packages/queue-manager/src/index.ts](../packages/queue-manager/src/index.ts).
4. Actualizează importurile:
   - Ingress: [apps/backend-worker/src/routes/webhooks.ts](../apps/backend-worker/src/routes/webhooks.ts) → import din `@app/queue-manager`.
   - Worker webhook: [apps/backend-worker/src/processors/webhooks/worker.ts](../apps/backend-worker/src/processors/webhooks/worker.ts) → import `WEBHOOK_QUEUE_NAME` din `@app/queue-manager`.
5. Decide explicit ce facem cu [apps/backend-worker/src/queue/webhook-queue.ts](../apps/backend-worker/src/queue/webhook-queue.ts):
   - Variante acceptabile în PR-021:
     - **A.** Ștergere + update toate importurile.
     - **B.** Păstrează ca thin re-export (deprecate) pentru 1 PR, apoi ștergere în PR următor.

### Validări (din Plan + repo)
- Automat:
  - `pnpm --filter @app/backend-worker test`
  - `pnpm --filter @app/queue-manager test`
- Manual (end-to-end):
  1. Pornește Redis (dev): `pnpm db:up`
  2. Pornește backend-worker: `pnpm --filter @app/backend-worker dev`
  3. Trimite un webhook valid (din test harness sau cu `curl`) și confirmă că ingress răspunde rapid și că job-ul apare în `webhook-queue` (ex: via `QueuePro.getJobCounts()` dintr-un script scurt).

---

## F4.1.6 — Worker lifecycle hardening (scheduler/events, stalled detection, graceful shutdown)

### Obiectiv
- Delayed jobs / retry/backoff să fie procesate robust (fără “stuck delayed”).
- Evenimente operaționale standard (stalled/failed/lock renewal) observabile.
- Shutdown controlat pe SIGTERM: nu ia job-uri noi, așteaptă job-urile active (cu timeout), fără pierderi.

### Implementare (pași)
1. **Clarificare scheduler în BullMQ Pro (fără presupuneri):**
   - În repo există `QueuePro.jobScheduler: Promise<JobSchedulerPro>` (BullMQ Pro v7.41.0) — vezi typings.
   - În PR-021: implementăm un helper în `@app/queue-manager` care:
     - creează queue (`createQueue`)
     - inițializează scheduler-ul prin `await queue.jobScheduler` (și eventual `.close()` la shutdown)
   - Validarea practică: un job cu delay / retry backoff trebuie să “revină” din delayed în waiting fără intervenție manuală.
2. **Standardizează “worker bundle”** în `@app/queue-manager`:
   - helper care pornește `WorkerPro` + `QueueEventsPro` (+ scheduler dacă e necesar)
   - returnează un handle unic cu `closeGracefully({ timeoutMs })`.
3. **Stalled detection**:
   - webhook worker are deja listeners pe `QueueEventsPro` (`stalled`, `failed`).
   - extinde doar cu semnale utile existente în BullMQ (ex: `lockRenewalFailed`, dacă este expus de WorkerPro) și păstrează loguri compacte (fără payload).
4. **Graceful shutdown**:
   - În [apps/backend-worker/src/main.ts](../apps/backend-worker/src/main.ts), înainte de `.close()`:
     - `await worker.pause(/* doNotWaitActive */ false)` unde e posibil.
     - `await worker.close(false)` cu timeout global (ex: `Promise.race` cu 10–15s) ca să evităm hang.
   - Închide și `QueueEventsPro` + scheduler (dacă e instanțiat).
5. **Token-health worker** (BullMQ OSS) — decizie explicită:
   - Minim pentru PR-021: îl includem în shutdown hardening (timeout + close), fără migrare.
   - Opțional (dacă încape fără risc): migrare la `@app/queue-manager` pentru consistență, dar asta poate fi lăsată pentru PR separat.

### Validări (din Plan)
- Manual (scenariu controlat):
  1. Rulează un job webhook care durează (temporar, într-un mediu de test) >5s.
  2. Trimite SIGTERM procesului în timpul job-ului.
  3. Confirmă: procesul se oprește controlat, iar job-ul fie finalizează, fie este re-luat/retry (stalled recovery) — fără “job pierdut”.

---

## F4.1.7 — Health/readiness pentru worker + verificări operaționale

### Obiectiv
- Readiness reflectă:
  - Redis reachable (deja există)
  - worker(s) running / not crashed
  - (best-effort) queue connectivity
- Fără a expune detalii sensibile.

### Implementare (pași)
1. Extinde `/health/ready` în [apps/backend-worker/src/http/server.ts](../apps/backend-worker/src/http/server.ts) cu un check nou, de tip boolean:
   - `checks.workers = ok|fail` sau (mai granular) `checks.worker_webhook`, `checks.worker_token_health`.
2. Creează un “worker status registry” în `apps/backend-worker/src/` (ex: `runtime/worker-registry.ts`) care:
   - expune `setWebhookWorkerHandle(handle)` / `setTokenHealthWorkerHandle(handle)`
   - expune `getWorkersReady()` care folosește API-uri existente (`worker.isRunning()` pentru BullMQ Worker/WorkerPro).
3. În [apps/backend-worker/src/main.ts](../apps/backend-worker/src/main.ts), după start, înregistrează handle-urile în registry.
4. În readiness, folosește timeout mic (ex: 250–500ms) pentru verificarea worker status ca să nu blocheze.

### Validări (din Plan)
- Când Redis e up și workerii rulează → `/health/ready` = 200.
- Când Redis e down → `/health/ready` = 503.
- Când workerul e oprit/crashed (simulat) → `/health/ready` = 503 (fail controlat).

---

## F4.1.8 — Teste de integrare pentru queue-manager (node:test)

### Obiectiv
- Suite de teste care validează infrastructura de cozi (E2E + DLQ + retry + retenție/cleanup), rulabilă local și în CI.

### Reality (astăzi)
- E2E + DLQ există deja în [packages/queue-manager/src/__tests__/queue-manager.integration.test.ts](../packages/queue-manager/src/__tests__/queue-manager.integration.test.ts).
- CI pornește Redis ephemeral în [ci-pr.yml](../.github/workflows/ci-pr.yml).

### Implementare (pași)
1. Completează acoperirea pentru “retenție/cleanup” folosind utilitarul existent `pruneQueue(...)` din:
   - [packages/queue-manager/src/queue-manager.ts](../packages/queue-manager/src/queue-manager.ts)
2. Adaugă un test de integrare care:
   - creează o coadă,
   - inserează job-uri în stări relevante,
   - rulează `pruneQueue` cu un prag mic,
   - verifică reducerea count-urilor.
3. Păstrează constrângerea Planului: **fără Jest**.

### Validări
- Local:
  - `pnpm --filter @app/queue-manager test` (cu `REDIS_URL` + `BULLMQ_PRO_TOKEN` setate)
- CI:
  - `pnpm test` trebuie să treacă (Redis service + env deja setate în workflow).

---

## Checklist “definition of done” pentru PR-021

- Cod: ingress webhook importă producer din `@app/queue-manager`.
- Worker lifecycle: shutdown controlat + events/scheduler acolo unde e necesar.
- Health: `/health/ready` include worker status, fără info sensibil.
- Teste: `pnpm ci` trece local și în CI.
