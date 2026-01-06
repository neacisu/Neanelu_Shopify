# PR-021 Plan (F4.1.5–F4.1.8) — `pr/F4.1-refactor-enqueue`

> Scop: plan de implementare **100% ancorat în repo** (Plan + Docs + cod existent), fără presupuneri despre API-uri inexistente.

## Scope (din Plan_de_implementare)

- **F4.1.5** Refactor: mută enqueue-ul minim din F3 în `@app/queue-manager`.
- **F4.1.6** Worker lifecycle hardening (scheduler/events, stalled detection, graceful shutdown).
- **F4.1.7** Health/readiness pentru worker + verificări operaționale.
- **F4.1.8** Teste de integrare pentru `@app/queue-manager` (node:test), CI cu Redis ephemeral.

## Decizii implicite (recomandate) pentru PR-021

1. **Webhook pipeline = BullMQ Pro via `@app/queue-manager` (producer + worker + events).** Nu introducem BullMQ OSS scheduler pe fluxul webhook.
2. **`@app/queue-manager` rămâne agnostic de logger.** Păstrăm compatibilitatea cu semnătura efectiv folosită în repo: `enqueueWebhookJob(payload, loggerLike)` (fără dependență internă pe `@app/logger`).
3. **Token-health rămâne BullMQ OSS în PR-021 (doar hardening la shutdown).** Readiness gate = webhook worker; token-health este best-effort / informațional.

## Reality check (ce există deja în repo)

### Producer webhook (astăzi)

- Ingress: [apps/backend-worker/src/routes/webhooks.ts](../apps/backend-worker/src/routes/webhooks.ts)
  - Apelează `enqueueWebhookJob(jobPayload, request.log)`.
- Producer: [apps/backend-worker/src/queue/webhook-queue.ts](../apps/backend-worker/src/queue/webhook-queue.ts)
  - Deja folosește `@app/queue-manager` (`createQueue`, `configFromEnv`) și exportă `WEBHOOK_QUEUE_NAME`.

### Worker webhook (astăzi)

- Worker: [apps/backend-worker/src/processors/webhooks/worker.ts](../apps/backend-worker/src/processors/webhooks/worker.ts)
  - Folosește `@app/queue-manager` (`createWorker`, `createQueueEvents`).

### Health (astăzi)

- Endpoint-uri: [apps/backend-worker/src/http/server.ts](../apps/backend-worker/src/http/server.ts)
  - `/health/live` și `/health/ready` (DB + Redis + Shopify config).
  - `checks` are chei `database`, `redis`, `shopify_api` cu valori `ok|fail`.
  - Nu include status worker.

### Teste queue-manager (astăzi)

- `node:test` + `tsx`: [packages/queue-manager/package.json](../packages/queue-manager/package.json)
- Integrare existentă: [packages/queue-manager/src/`__tests__`/queue-manager.integration.test.ts](../packages/queue-manager/src/__tests__/queue-manager.integration.test.ts)
- CI are Redis ephemeral deja: [ci-pr.yml](../.github/workflows/ci-pr.yml)

## Diferențe față de Plan (de tratat explicit în PR-021)

- Planul F3.3.3 menționează `enqueueWebhookJob(payload)` ca semnătură-contract. În codul actual, consumer-ul folosește **două argumente**: `enqueueWebhookJob(payload, logger)`.
  - În PR-021 păstrăm compatibilitatea cu semnătura efectiv folosită în repo.
- Planul F4.1.7 menționează `/healthz`, dar Docs + cod folosesc `/health/live` și `/health/ready`.
  - În PR-021 extindem `/health/ready` fără a introduce endpoint nou public.

---

## F4.1.5 — Refactor: mută enqueue-ul minim din F3 în queue-manager

### Obiectiv

- Endpoint-ul webhook importă producer-ul din `@app/queue-manager` (nu din `apps/backend-worker/src/queue`).
- Păstrăm semantica “răspuns rapid” în ingress.

### Implementare (pași)

1. În `@app/queue-manager`, adaugă un modul dedicat webhook producer (ex: `packages/queue-manager/src/webhooks.ts` sau `src/producers/webhook.ts`).
2. Mută logica din [apps/backend-worker/src/queue/webhook-queue.ts](../apps/backend-worker/src/queue/webhook-queue.ts) în noul modul, inclusiv:
   - `WEBHOOK_QUEUE_NAME`
   - `enqueueWebhookJob(...)`
   - `closeWebhookQueue()` (pentru shutdown)
   - `cleanupWebhookJobsForShopDomain(...)` (doar dacă rămâne folosit în backend-worker)
3. Expune API-ul prin [packages/queue-manager/src/index.ts](../packages/queue-manager/src/index.ts).
4. Actualizează importurile:
   - Ingress: [apps/backend-worker/src/routes/webhooks.ts](../apps/backend-worker/src/routes/webhooks.ts) → import din `@app/queue-manager`.
   - Worker webhook: [apps/backend-worker/src/processors/webhooks/worker.ts](../apps/backend-worker/src/processors/webhooks/worker.ts) → import `WEBHOOK_QUEUE_NAME` din `@app/queue-manager`.
5. [apps/backend-worker/src/queue/webhook-queue.ts](../apps/backend-worker/src/queue/webhook-queue.ts):
   - **Decizie PR-021 (default): păstrăm ca thin re-export/shim pentru 1 PR**, apoi ștergere într-un PR ulterior.
   - Motivație repo-grounded: există test care mock-uiește modulul prin URL (`new URL('../../queue/webhook-queue.js', import.meta.url).href` în `apps/backend-worker/src/routes/__tests__/webhooks.test.ts`). Dacă mutăm/ștergem în același PR, crește blast radius-ul în test/mocking fără valoare directă pentru F4.1.5.

### Validări

- Automat:
  - `pnpm --filter @app/backend-worker test`
  - `pnpm --filter @app/queue-manager test`
- Manual (end-to-end):
  1. Pornește Redis (dev): `pnpm db:up`
  2. Pornește backend-worker: `pnpm --filter @app/backend-worker dev`
  3. Trimite un webhook valid și confirmă că ingress răspunde rapid și că job-ul apare în `webhook-queue`.

---

## F4.1.6 — Worker lifecycle hardening (scheduler/events, stalled detection, graceful shutdown)

### Obiectiv

- Delayed jobs / retry/backoff să fie procesate robust (fără “stuck delayed”).
- Shutdown controlat pe SIGTERM: nu ia job-uri noi, așteaptă job-urile active (cu timeout), fără pierderi.

### Implementare (pași)

1. Clarifică scheduler în BullMQ Pro (fără presupuneri):
   - În repo există `QueuePro.jobScheduler: Promise<JobSchedulerPro>` (BullMQ Pro v7.41.0).
   - În PR-021: doar dacă este necesar pentru delayed/retry în contextul nostru, inițializează explicit prin `await queue.jobScheduler` și închide la shutdown.
2. Standardizează un “worker bundle” în `@app/queue-manager`:
   - pornește `WorkerPro` + `QueueEventsPro` (+ scheduler dacă e necesar)
   - returnează un handle unic cu `closeGracefully({ timeoutMs })`
3. Stalled/failed observability:
   - păstrează listeners existenți și adaugă doar semnale reale expuse de BullMQ Pro/WorkerPro (fără payload în log).
4. Graceful shutdown:
   - în [apps/backend-worker/src/main.ts](../apps/backend-worker/src/main.ts) aplică `pause()` + `close()` cu timeout global.
   - închide și `QueueEventsPro` + scheduler (dacă sunt instanțiate).
5. Token-health worker (BullMQ OSS):
   - minim în PR-021: include-l în shutdown hardening (timeout + close), fără migrare.

### Validări

- Manual (scenariu controlat):
  1. Rulează un job webhook care durează (temporar, într-un mediu de test) >5s.
  2. Trimite SIGTERM procesului în timpul job-ului.
  3. Confirmă: procesul se oprește controlat; job-ul fie finalizează, fie este reluat via retry/stalled recovery (fără “job pierdut”).

---

## F4.1.7 — Health/readiness pentru worker + verificări operaționale

### Obiectiv

- Readiness reflectă: Redis reachable, worker webhook “up”, (best-effort) token-health.
- Fără a expune detalii sensibile.

### Implementare (pași)

1. Extinde `/health/ready` în [apps/backend-worker/src/http/server.ts](../apps/backend-worker/src/http/server.ts) cu checks noi (aceeași convenție ca cele existente: `ok|fail`):
   - `checks.worker_webhook = ok|fail` (**readiness gate**)
   - `checks.worker_token_health = ok|fail` (best-effort / informațional; nu blochează readiness singur)
2. Creează un “worker status registry” în `apps/backend-worker/src/` (ex: `runtime/worker-registry.ts`) care:
   - expune `setWebhookWorkerHandle(handle)` / `setTokenHealthWorkerHandle(handle)`
   - expune `getWorkersReady()` pe baza API-urilor existente (`worker.isRunning()` pentru BullMQ Worker/WorkerPro)
3. În [apps/backend-worker/src/main.ts](../apps/backend-worker/src/main.ts), după start, înregistrează handle-urile în registry.
4. În readiness, folosește timeout mic (ex: 250–500ms) ca să nu blochezi request-ul.
5. Gating: status/HTTP code se calculează pe checks obligatorii (inclusiv `worker_webhook`), nu pe token-health.

### Validări

- Când Redis e up și webhook worker rulează → `/health/ready` = 200.
- Când Redis e down → `/health/ready` = 503.
- Când webhook worker e oprit/crashed (simulat) → `/health/ready` = 503.

---

## F4.1.8 — Teste de integrare pentru queue-manager (node:test)

### Obiectiv

- Suite de teste care validează infrastructura de cozi (E2E + DLQ + retenție/cleanup), rulabilă local și în CI.

### Reality (astăzi)

- E2E + DLQ există deja în [packages/queue-manager/src/`__tests__`/queue-manager.integration.test.ts](../packages/queue-manager/src/__tests__/queue-manager.integration.test.ts).

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
  - `pnpm -w run ci`

---

## Checklist “definition of done” pentru PR-021

- Cod: ingress webhook importă producer din `@app/queue-manager`.
- Worker lifecycle: shutdown controlat + events/scheduler acolo unde e necesar.
- Health: `/health/ready` include worker status, fără info sensibil.
- Teste: `pnpm -w run ci` trece local și în CI.

## Open questions (opțional)

1. Pentru `checks.worker_token_health`: preferi să fie mereu prezent (ok|fail) sau omis când workerul nu e pornit?
2. Vrei PR separat pentru migrarea token-health în `@app/queue-manager` (după PR-021), sau rămâne intenționat BullMQ OSS?
