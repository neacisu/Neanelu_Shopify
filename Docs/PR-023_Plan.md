# PR-023 Plan (F4.3) — Rate limiting distribuit (Shopify cost-based + 429 + backoff + bulk lock)

Branch: `pr/F4.3-rate-limiting`

Data: 2026-01-06

## 0) Constrângeri („nu halucinez”)

Acest plan este construit STRICT pe:

- cerințele din `Plan_de_implementare.md` (secțiunea F4.3.1–F4.3.6)
- schema deja existentă în `packages/database/drizzle/migrations/0013_rate_limiting.sql`
- runbook-ul existent `Docs/runbooks/rate-limit-emergency.md`
- tipurile reale din BullMQ/BullMQ Pro prezente în repo (ex. `WorkerPro#rateLimitGroup`, `Job#moveToDelayed`, `DelayedError`)
- documentația oficială Shopify (Shopify.dev) pentru:
  - Admin API GraphQL rate limits (`extensions.cost.throttleStatus` incl. `restoreRate`)
  - Admin API REST rate limits + `429` + `Retry-After`

Nu inventez APIs/simboluri. Dacă un nume apare în cerință dar nu există în typings, planul îl înlocuiește cu API-ul real din typings.

## 1) Referințe (surse consultate)

### Repo (contracte interne)

- `Plan_de_implementare.md` → F4.3.1–F4.3.6 (cerințe, path-uri, restricții anti-halucinație)
- `packages/database/drizzle/migrations/0013_rate_limiting.sql`
  - `rate_limit_buckets` (are `refill_rate DEFAULT 2.0`)
  - `api_cost_tracking` (are coloane pentru `restore_rate`, etc.)
- `Docs/runbooks/rate-limit-emergency.md`
- `packages/queue-manager/src/queue-manager.ts` (WorkerPro, wrapper processor, backoffStrategy)
- `packages/queue-manager/src/strategies/fairness/group-id.ts` (groupId canonicalizat pentru shopId)

### Shopify (documentație publică)

(Verificat în această sesiune pe 2026-01-06)

- GraphQL Admin API rate limits: throttleStatus în `extensions.cost` (ex. `maximumAvailable`, `currentlyAvailable`, `restoreRate`)
  - ['https://shopify.dev/docs/api/usage/rate-limits']
- REST Admin API rate limits + 429 + Retry-After
  - ['https://shopify.dev/docs/api/usage/rate-limits']
  - ['https://shopify.dev/docs/api/admin-rest']

## 2) Modelul corect (F4.3.1) — 3 mecanisme diferite

### 2.1 GraphQL (cost-based)

- Bugetul este în „puncte”, nu requests/sec.
- Semnale: `extensions.cost.throttleStatus`:
  - `maximumAvailable`: capacitatea maximă
  - `currentlyAvailable`: bugetul curent
  - `restoreRate`: puncte/sec recâștigate
- Regula proactivă cerută: dacă `currentlyAvailable < costNecesar`, nu facem call; returnăm `delayMs = (costNecesar - currentlyAvailable) / restoreRate * 1000`.

### 2.2 REST (request-based + 429)

- Limita este request-based. Shopify folosește 429 pentru throttling.
- Regula reactivă cerută: dacă răspunsul este `429`, respectăm `Retry-After` (secunde) → delay derivat.

### 2.3 Bulk Operations (concurrency 1/shop)

- Nu este „rate limit”, este „concurrency limit”.
- Regula: 1 bulk activ per shop; al doilea job bulk trebuie să aștepte (delay), fără a bloca alte shop-uri.

## 3) Decizie de arhitectură (aliniere cu schema DB existentă)

Există două surse de „rate” în repo:

- `rate_limit_buckets.refill_rate DEFAULT 2.0` din migrare — aceasta corespunde natural REST refill tipic (2 req/sec) și/sau unui default conservator.
- Shopify GraphQL `restoreRate` tipic 50 puncte/sec (variază în funcție de plan), venit din răspuns.

Planul tratează aceste resurse ca bucket-uri diferite:

- Bucket REST per shop (`unit = request`)
- Bucket GraphQL per shop (`unit = cost points`), a cărui rată reală se actualizează din `throttleStatus.restoreRate`

**DB-ul rămâne pentru tracking/analytics + configurare default**, iar **Redis/Lua** este pentru gating atomic în runtime.

## 4) Livrabile pe task-uri (F4.3.1–F4.3.6)

### F4.3.1 — `packages/shopify-client/src/rate-limiting.ts` + docs

**Scop:** cod + documentație care modelează explicit cele 3 mecanisme (GraphQL cost, REST 429, Bulk concurrency).

**De creat/modificat:**

1) `packages/shopify-client/src/rate-limiting.ts`
   - tipuri pentru semnalele Shopify:
     - `ShopifyGraphqlThrottleStatus` (currentlyAvailable, maximumAvailable, restoreRate)
     - `ShopifyGraphqlCostExtensions` (request/actual cost + throttleStatus) — doar ce există în Shopify răspuns
   - helper-e pure (fără dependență de redis):
     - `computeGraphqlDelayMs(params)`
     - `parseRetryAfterSeconds(headers)`
     - `computeRestDelayMsFromRetryAfter(headers)`
   - constantă „default GraphQL model” documentată, dar *nu hardcodăm delay fix*.

2) `packages/shopify-client/src/index.ts`
   - exportă `rate-limiting.ts` (altfel package-ul nu expune nimic).

3) `packages/shopify-client/package.json`
   - adaugă script `"build": "tsc -p tsconfig.json"` (aliniat cu alte packages, ex. `@app/logger`).

**Validare (cerută):**

- Codul și doc-ul reflectă explicit toate cele 3 modele.
- Nu tratăm GraphQL și REST identic.
- Nu confundăm rate limit cu bulk concurrency.

---

### F4.3.2 — Lua atomic token bucket (Redis) + wrapper TS

**Scop:** buget per shop atomic (fără race conditions) + return (allowed/delayMs). Fără „sleep activ”.

**De creat/modificat:**

  M1) `packages/queue-manager/src/strategies/fairness/rate-limiter.lua`

- Lua implementează token bucket cu refill pe bază de timp.
- Contract (propus explicit):
  - KEY[1] = bucketKey
  - ARGV: nowMs, costToConsume, maxTokens, refillPerSecond
  - returnează: `{ allowed(0/1), delayMs, tokensRemaining, tokensNow }`

  M2) `packages/queue-manager/src/strategies/fairness/rate-limiter.ts`

- wrapper TS care:
  - încarcă script-ul (load/evalsha cu fallback la eval)
  - expune funcție `checkAndConsumeCost(redis, params)`
  - nu face sleep; doar calculează și returnează delay.

**Observație importantă:** cerința spune „Restore rate consistent cu Shopify (50 points/sec typical)”, dar planul nu hardcodează 50 ca adevăr global.
> default-ul inițial poate fi 50 pentru GraphQL doar ca „bootstrapping” (până avem semnal real), dar după primul răspuns se actualizează din `throttleStatus.restoreRate`.

**Validare (cerută):**

- Test de concurență mare: fără „double spend” / fără bugete negative.

---

### F4.3.3 — Integrare limiter în procesarea job-urilor Shopify

**Scop:** înainte de orice call Shopify în context de job processing:

1) check buget
2) dacă suficient → consume și continue
3) dacă insuficient → job delayed (nu retry storm)

**BullMQ Pro:** cerința cere „Folosește `rateLimitGroup` unde posibil”. Typings reale din repo confirmă:

- `WorkerPro#rateLimitGroup(job, expireTimeMs)` există
- `Job#moveToDelayed(timestamp, token?)` există
- `DelayedError` există

**Implementare propusă (fără sleep):**

- Introducem un mecanism standard „delay fără fail”:
  - `await job.moveToDelayed(Date.now() + delayMs, token)`
  - `throw new DelayedError()` ca worker-ul să nu marcheze job-ul ca `completed`

- Integrarea `rateLimitGroup` (când avem acces la instanța worker):
  - la startup worker, păstrăm referință la worker și în processor:
    - `await workerRef.rateLimitGroup(job, delayMs)` (best-effort)
    - apoi `moveToDelayed + DelayedError`

**Unde se integrează concret în acest repo (astăzi):**

- job workers viitoare (ex. sync-queue / bulk-queue) vor folosi acest helper.
- chiar înainte să existe acei workers, putem integra rate-limit helpers în call-urile existente Shopify:
  - `apps/backend-worker/src/shopify/client.ts` (GraphQL)
  - `apps/backend-worker/src/auth/token-lifecycle.ts` (REST)

**Validare (cerută):**

- Sub load, nu depășim limitele per shop.
- Nu intrăm în retry storm (job-urile sunt delayed, nu fail/retry).

---

### F4.3.4 — Backoff corect la THROTTLED/429 (delay derivat din răspuns)

**Scop:** reactive throttling.

**REST 429:**

- dacă `status === 429` și există `Retry-After`, delay = `Retry-After * 1000`.
- dacă lipsește header-ul, fallback la backoff exponential cu jitter (folosind politica existentă din `packages/queue-manager/src/policy.ts`).

**GraphQL THROTTLED:**

- Shopify poate semnala „throttled” prin erori GraphQL (ex. mesaj) + `extensions.cost.throttleStatus`.
- delay derivat: `ceil((costNecesar - currentlyAvailable) / restoreRate * 1000)`.

**Unde se implementează:**

- `packages/shopify-client/src/rate-limiting.ts` — funcții pure de calcul
- `apps/backend-worker/src/shopify/client.ts` — când parsează răspunsul:
  - citește `extensions.cost.throttleStatus`
  - actualizează „restoreRate/currentlyAvailable” în Redis bucket (prin wrapper F4.3.2)
  - dacă detectează throttling, aruncă o eroare specială „rate-limited” care conține `delayMs`
- `packages/queue-manager` — wrapper în processor care convertește acea eroare în `moveToDelayed + DelayedError`

**Fallback backoff profesionist (anti-storm):**

- jitter (ex. full jitter) peste delay-ul calculat, cu cap (ex. 60s), pentru a evita sincronizarea retry-urilor între multe jobs.
- dar: dacă există `Retry-After`, acesta rămâne baza (nu o ignorăm).

**Validare (cerută):**

- test: răspuns 429 cu `Retry-After: 2` → job delayed ~2000ms (± jitter dacă este configurat)
- test: THROTTLED + throttleStatus → delay derivat corect (fără hardcode delay fix)

---

### F4.3.5 — Lock distribuit „1 bulk activ per shop” (integrat cu fairness)

**Scop:** 1 bulk activ per shop; al doilea bulk job așteaptă (delay), fără a bloca alte shop-uri.

**Aliniere fairness (F4.2):**

- key pattern cerut: `bulk-lock:${shopId}`
- `shopId` folosit în lock MUST match groupId din BullMQ Groups.
- în repo există deja normalizarea groupId în `packages/queue-manager/src/strategies/fairness/group-id.ts` — planul va folosi aceeași normalizare pentru lock.

**De creat/modificat:**

- `packages/queue-manager/src/locks/bulk-lock.lua`
  - acquire: `SET key value NX PX ttl`
  - renew: `PEXPIRE key ttl` doar dacă value se potrivește
  - release: `DEL key` doar dacă value se potrivește

- `packages/queue-manager/src/locks/bulk-lock.ts`
  - `acquireBulkLock(shopId, { ttl, refreshInterval })`
  - `releaseBulkLock(shopId, token)`
  - optional: `startBulkLockRenewal(...)` (timer) — doar pentru bulk jobs de durată mare

**Comportament cerut (fără sleep):**

- dacă nu poți lua lock:
  - job-ul se mută în delayed (ex. re-check după X ms) fără a consuma attempts

**Validare (cerută):**

1. două bulk job-uri simultane pe același shop → al doilea așteaptă
2. bulk jobs pe shops diferite → procesare paralelă
3. key pattern matches group key pattern (shopId identic)

---

### F4.3.6 — Teste integrare (rate limiting + lock)

**Scop:** teste deterministe care rulează în CI cu Redis real (container), fără Shopify real.

**De adăugat:** `packages/queue-manager/src/__tests__/rate-limiting.integration.test.ts`

**Teste propuse:**

T1. Lua atomicity

- pornești N promise-uri concurente care încearcă să consume cost din același bucket
- aserți că suma consumată nu depășește capacitatea + refill
- aserți că nu există tokens negative

T2. Backoff 429

- simulezi funcție „call Shopify” care returnează status 429 + `Retry-After`
- verifici că job-ul este mutat în delayed cu timestamp coerent

T3. Bulk lock

- două jobs bulk cu același shopId:
  - primul ia lock și ține lock-ul scurt
  - al doilea detectează lock și se mută delayed
  - după release, al doilea rulează

**Cerinte anti-halucinație (respectate):**

- fără apeluri Shopify reale (mock)
- Redis real obligatoriu (same pattern ca `queue-manager.integration.test.ts`)

## 5) Pași de implementare (ordine recomandată)

1. F4.3.1: creează `packages/shopify-client/src/*` + export + build script
2. F4.3.2: adaugă `rate-limiter.lua` + wrapper TS în `packages/queue-manager`
3. F4.3.4: calcule delay pentru 429/THROTTLED în shopify-client (funcții pure) + integrare în call site (backend-worker)
4. F4.3.3: mecanism standard de „delay fără fail” în job processors (moveToDelayed + DelayedError) + opțional rateLimitGroup
5. F4.3.5: bulk lock lua + TS wrapper
6. F4.3.6: teste integrare cu Redis

## 6) Checklist de acceptanță (PR-023)

- [ ] există `packages/shopify-client/src/rate-limiting.ts` + docs (F4.3.1)
- [ ] există token bucket Lua atomic + wrapper TS (F4.3.2)
- [ ] există integrare pre-call check pentru jobs Shopify (F4.3.3)
- [ ] backoff reactiv la 429/THROTTLED derivă delay din răspuns (F4.3.4)
- [ ] lock bulk 1/shop și nu blochează alte shops (F4.3.5)
- [ ] teste integrare rulează în CI cu Redis real (F4.3.6)
