# Rezumat complet – Chat implementare și infrastructură Neanelu

Document de referință cu **informații 100% reale și factuale** despre aplicația Neanelu Shopify Manager, infrastructura curentă și modificările implementate în aceste chat-uri.

**Acoperire**: Infrastructură (mașini, Traefik, DB, Redis); secrets și OpenBao; eliminare .env; hot-reload dev (docker-compose.dev-local.yml, volume mounts, backend-worker-dev, web-admin-dev); CD deploy; dashboard UI (InfoTooltip, KPI, Recharts, QuickActions); backend (serper/xai, bulk-lock, teste); pagina Queues (etichete RO, tooltip-uri, queue-display.ts); status „In timp real” (interval 15s, RealtimeQueueStatus, animații); fix WebSocket „Aștept primul snapshot…” (cauză @fastify/websocket v11, modificări queues/bulk/pim-stats, frontend lastSnapshotAt/session_required); proxy WS (vite.proxy-ws.ts, vite.config.ts, tsconfig); script test test-queues-ws.ts (tipizare, token din DB, @types/ws); eliminare scripturi redundante (.mjs, .py); pagina Queues tab Workeri – fix afișare tooltip-uri (boundaryRef, portal, limitare la card); commit-uri (244c6f6, ab73f82, 1dd6c3e).

---

## 1. Aplicația Neanelu – generalități

- **Nume**: Neanelu Shopify Manager (enterprise application).
- **Repository**: monorepo pnpm workspace (`neanelu-shopify`, `packageManager: pnpm@10.28.0`).
- **Node**: `>=24.0.0` (engine).
- **Structură**:
  - **apps/**:
    - **backend-worker**: API Fastify, job-uri BullMQ Pro, workers (sync, webhooks, bulk, PIM, AI).
    - **web-admin**: frontend React, React Router 7, Vite, Tailwind CSS, Shopify App Bridge.
  - **packages/**: `@app/database` (Drizzle), `@app/config`, `@app/queue-manager`, PIM, scraper, etc.
- **Baza de date**: PostgreSQL 18.1 cu pgvector, Drizzle ORM, migrări Drizzle, RLS, criptare AES-256-GCM pentru credențiale sensibile.
- **Redis**: ioredis – cozi BullMQ, rate limiting, cache.
- **AI/ML**: OpenAI, Serper API, xAI (Grok).
- **Shopify**: OAuth 2.0, HMAC, GraphQL API, webhooks.

---

## 2. Infrastructură – topologie reală

### 2.1 Mașini și roluri

| Mașină | IP | Rol | Detalii |
| -------- | ----- | ----- | --------- |
| **hz.164** | 135.181.183.164 | **Dev** | Cod sursă în `/var/www/Neanelu_Shopify`. Containere dev: `neanelu-web-admin-dev`, `neanelu-backend-worker-dev`. OpenBao agent dev montează template-uri din workspace și scrie în `/run/neanelu-dev/runtime-secrets/api/`. |
| **Orchestrator** | 77.42.76.185 | **Shared services** | Traefik (reverse proxy, TLS/ACME), OpenBao server, Grafana, Loki, Tempo, Prometheus, Redis partajat, OTel Collector. Config Traefik dinamic: `/opt/traefik/dynamic/neanelu.yml`. |
| **CT112** | 10.0.1.112 | **Staging** | LXC Proxmox. Deploy: `/opt/neanelu`, `docker-compose.staging.yml`, imagini GHCR. |
| **CT111** | 10.0.1.111 | **Production** | LXC Proxmox. Deploy: `/opt/neanelu`, `docker-compose.prod.yml`, imagini GHCR. |
| **CT107** | 10.0.1.107 | **PostgreSQL** | Server PostgreSQL principal; migrările și unele tool-uri folosesc conexiune directă la 5432. |

### 2.2 Trafic și domenii

- **Dev**: Browser → Orchestrator (Traefik) → `dev.manager.neanelu.ro` → hz.164 (porți 65100 backend, 65101 frontend în config Traefik).
- **Staging**: `https://staging.manager.neanelu.ro` → Traefik → CT112.
- **Production**: `https://manager.neanelu.ro` → Traefik → CT111.

### 2.3 Baze de date per mediu

- **Dev**: `neanelu_shopify_dev` (DB pe CT107, acces via PgBouncer din Docker sau `MIGRATION_DATABASE_URL` direct 10.0.1.107:5432).
- **Staging**: `neanelu_shopify_staging`.
- **Production**: `neanelu_shopify`.

Runtime folosește PgBouncer (port 6432, fără TLS – `DB_SSL_MODE=disable`). Tool-uri de migrare/studio folosesc `MIGRATION_DATABASE_URL` (conexiune directă la CT107:5432).

---

## 3. Secrets și configurare – starea curentă

### 3.1 Eliminarea fișierului `.env`

- **Fișierul `.env` a fost eliminat** din proiect; nu mai există în workspace.
- Toate variabilele de runtime pentru API/workers provin din **OpenBao** (template `neanelu-api.env.ctmpl`), randate de agentul OpenBao în:
  - **Dev**: `/run/neanelu-dev/runtime-secrets/api/neanelu-api.env`
  - **Staging/Prod** (pe LXC): path configurat prin `NEANELU_RENDERED_SECRETS_DIR` (ex. `/run/neanelu/runtime-secrets`).
- **`.env.example`** există în git doar pentru validare CI (`docker compose config`) și documentație.
- **`.env.infra`** (nou): conține doar secrete de infrastructură (unseal OpenBao, API Hetzner, WireGuard, SSH server, admin Traefik/Grafana, superuser Postgres). Este în `.gitignore`.

### 3.2 OpenBao – template API

- **Locație**: `infra/config/openbao/templates/neanelu-api.env.ctmpl`.
- **Engine**: KV v1 (read-merge-write pentru actualizări; nu patch).
- Variabile derivate în template (fără scrieri suplimentare în KV):
  - `NPM_TASKFORCESH_TOKEN={{ .Data.bullmq_pro_token }}` (din secret API existent).
  - `APP_HOSTNAME={{ trimPrefix "https://" .Data.app_host }}`.
- **Medii**: `NEANELU_ENV` = `dev` | `staging` | (implicit prod). Pentru fiecare: DB name, role Vault/DB, path-uri `secret/neanelu/{dev|staging|prod}/api` și redis.
- **Redis**: URL și prefix din `secret/neanelu/{env}/redis`.
- **Database**: credențiale dinamice din `neanelu-db/creds/{role}`; `DATABASE_URL` către pgbouncer:6432; `MIGRATION_DATABASE_URL` către 10.0.1.107:5432.

### 3.3 Script `with-secrets.sh`

- **Locație**: `scripts/with-secrets.sh` (executabil).
- **Rol**: wrapper pentru tool-uri locale (ex. Drizzle Kit: generate, migrate, studio, push, seed, teste DB) care au nevoie de env.
- **Comportament**:
  - Citește env din `NEANELU_SECRETS` sau implicit `/run/neanelu-dev/runtime-secrets/api/neanelu-api.env`.
  - Dacă fișierul lipsește, afișează eroare și încheie cu exit 1.
  - Setează `DATABASE_URL="${MIGRATION_DATABASE_URL:-$DATABASE_URL}"` pentru acces direct la DB (bypass PgBouncer).
  - Execută comanda pasată ca argumente (`exec "$@"`).
- **Utilizare**: toate scripturile `db:generate`, `db:migrate`, `db:studio`, `db:push`, `db:seed*`, `db:test*` din `package.json` rulează prin `scripts/with-secrets.sh pnpm --filter @app/database ...`.

### 3.4 Backend – lipsa dotenv

- În `apps/backend-worker/src/main.ts` și `apps/backend-worker/src/otel/register.ts` **nu mai există** `import 'dotenv/config'`.
- Env-ul vine din proces (Docker/OpenBao: `env_file` către fișierul randat).

---

## 4. Hot-reload în dev (hz.164)

### 4.1 Comandă și fișiere

- **Pornire**: `pnpm dev:local` (din root). Rulează: `scripts/with-secrets.sh docker compose -f docker-compose.staging.yml -f docker-compose.dev-local.yml --profile dev up -d backend-worker-dev web-admin-dev`.
- **Build inițial**: `pnpm dev:local:build` (build --no-cache pentru `backend-worker-dev` și `web-admin-dev`).
- **Logs**: `pnpm dev:local:logs`.

### 4.2 Override `docker-compose.dev-local.yml`

- **Scop**: override pentru `docker-compose.staging.yml --profile dev` pe hz.164; adaugă build local și volume mounts pentru hot-reload.
- **backend-worker-dev**:
  - Build: `context: .`, `dockerfile: apps/backend-worker/Dockerfile`.
  - Image: `neanelu-backend-worker:local-dev`.
  - Volume: `./apps/backend-worker/src:/app/apps/backend-worker/src`.
  - Command: `['sh', '-lc', 'pnpm --filter @app/backend-worker dev:watch']` (tsx watch).
  - Network alias: `backend-worker` (pentru proxy-ul Vite `/api` → `http://backend-worker:65000`).
- **web-admin-dev**:
  - Build: `apps/web-admin/Dockerfile.dev`.
  - Image: `neanelu-web-admin:local-dev`.
  - Volume: `./apps/web-admin/app`, `./apps/web-admin/components`, `./apps/web-admin/public`, `./apps/web-admin/vite.config.ts`, `./apps/web-admin/vite.proxy-ws.ts`, `./apps/web-admin/vite.shopify-hmr.ts`.
  - CMD: Vite dev server (`pnpm --filter @app/web-admin dev`); port 65001.
- **Secrets**: `npm_token` din env `NPM_TASKFORCESH_TOKEN` (injectat de `with-secrets.sh` din fișierul OpenBao).

### 4.3 Dockerfile.dev (web-admin)

- **Locație**: `apps/web-admin/Dockerfile.dev`.
- Base: `node:24-bookworm-slim`, pnpm 10.28.0, `WORKDIR /app`, COPY monorepo, `pnpm install --frozen-lockfile` cu secret npm_token.
- **EXPOSE 65001**.
- CMD: `export VITE_SHOPIFY_API_KEY=$SHOPIFY_API_KEY && pnpm --filter @app/web-admin dev` (Vite cu HMR).

### 4.4 Backend dev:watch

- În `apps/backend-worker/package.json`: script `dev:watch`: `tsx watch --import ./src/otel/register.ts src/main.ts`.
- Hot-reload backend = repornire automată la modificări în `apps/backend-worker/src`.

### 4.5 Traefik – dev fără stripPrefix

- Pe orchestrator, în `/opt/traefik/dynamic/neanelu.yml`, router-ul pentru **dev** (`neanelu-dev-admin`) **nu** folosește middleware-ul `neanelu-strip-app-prefix`.
- Motiv: Vite dev server are `base: '/app/'`; dacă Traefik stripă `/app`, se ajunge la redirect loop (`/` → redirect la `/app/` → strip → `/` → …).
- Staging/prod pot continua să folosească stripPrefix dacă e cazul (Nginx servește SPA de la `/` cu try_files).

---

## 5. CD / Deploy (staging & production)

### 5.1 Workflow

- **Fișier**: `.github/workflows/deploy.yml`.
- **Trigger**: `workflow_call` (din CI) sau `workflow_dispatch` cu inputs: `environment` (staging | production), `version` (tag imagine).
- **Build**: pe runner self-hosted `[self-hosted, neanelu]`; imagini push pe GHCR: `ghcr.io/neacisu/neanelu-shopify/backend-worker:$TAG`, `web-admin:$TAG`, etc.
- **Deploy**: SSH către `deploy@CT112` (staging) sau `deploy@CT111` (production). Director deploy: **`/opt/neanelu`** (pe LXC, nu în workspace).

### 5.2 Fișier deploy pe LXC

- **Nu se mai folosește** `/opt/neanelu/.env`.
- Se folosește **`/opt/neanelu/deploy.env`**, generat cu:
  - `NEANELU_VERSION`, `NEANELU_REGISTRY`, `NEANELU_IMAGE_PREFIX`.
- Comenzi: `docker compose -f ${COMPOSE} --env-file deploy.env pull ... up -d`.
- Rollback: se salvează `deploy.env.prev`; la rollback se copiază înapoi în `deploy.env`.

### 5.3 Consolidare dev pe hz.164

- **Fost director** `/opt/neanelu` pe hz.164 a fost eliminat; tot ce era necesar a fost mutat în **`/var/www/Neanelu_Shopify`** (workspace-ul curent).
- **Script restart la rotație secrets**: `infra/scripts/neanelu-secrets-restart.sh`; variabila `COMPOSE_DIR="/var/www/Neanelu_Shopify"`.
- **Systemd** (hz.164): unitatea `neanelu-secrets-restart@.service` folosește `ExecStart=.../var/www/Neanelu_Shopify/infra/scripts/neanelu-secrets-restart.sh`.

---

## 6. Dashboard UI – modificări implementate

### 6.1 Componenta InfoTooltip

- **Locație**: `apps/web-admin/app/components/ui/info-tooltip.tsx`.
- **Props**: `title`, `children` (conținut tooltip), `side?: 'top' | 'bottom'`, `maxWidth?: number` (implicit 425px), `boundaryRef?: React.RefObject<HTMLElement | null>` (opțional; v. §17).
- **Comportament**:
  - Tooltip cu lățime fixă (maxWidth), poziționare verticală sus/jos.
  - **Când `boundaryRef` e furnizat**: tooltip-ul se randează în portal (position: fixed), poziția orizontală este limitată la dreptunghiul elementului referit (ex. card), astfel nu se ascunde sub elemente vecine (v. §17).
  - **Când `boundaryRef` nu e furnizat** – aliniere orizontală dinamică (`align`: 'start' | 'center' | 'end') pentru a nu ieși din viewport:
    - **Margine stângă**: se folosește `getContentAreaLeft(trigger)` – parcurge DOM-ul în sus până la primul parent cu `overflow: auto|scroll|hidden` și folosește `getBoundingClientRect().left` + 8px (evită suprapunerea cu sidebar-ul).
    - **Margine dreaptă**: `window.innerWidth - 16`.
    - Dacă tooltip-ul ar depăși stânga → `align = 'start'` (tooltip la stânga, săgeata în stânga). Dacă ar depăși dreapta → `align = 'end'`. Altfel centrat.
  - Accesibilitate: `role="tooltip"`, `aria-describedby`, `aria-hidden`, Escape închide, focus/blur.

### 6.2 Dashboard (_index.tsx)

- **KPI cards**: animație `fadeSlideUp` cu delay progresiv (80ms între carduri), hover cu lift și border glow.
- **Fiecare KPI** are câmp `tooltip` și afișează `<InfoTooltip title={kpi.title}>{kpi.tooltip}</InfoTooltip>` lângă titlu.
- **Buton Reîncarcă datele**: tooltip explicativ; icon `RefreshCw` cu `animate-spin` când se reîmprospătează datele.
- **ActivityTimeline**: wrapper cu animație `fadeIn` (opacity only) pentru a nu afecta dimensiunile Recharts.
- **QuickActionsPanel**: tooltip-uri explicative pentru fiecare acțiune; butonul **View Logs** a fost eliminat (Grafana e doar pentru developeri/owner).

### 6.3 ActivityTimeline – grafic Recharts

- **Problema**: Recharts arunca warning `width(-1) and height(-1)`; ulterior graficul nu apărea pentru că `ResizeObserver` se atașa în `useEffect` cu dependența `[isClientMounted]`, dar la acel moment query-ul era încă loading și containerul nu era în DOM.
- **Soluție**:
  - **Ref callback** (`containerCallbackRef`) în loc de `useRef` + `useEffect`: când div-ul container apare în DOM, callback-ul se apelează, se măsoară cu `getBoundingClientRect()` și se atașează `ResizeObserver`.
  - Dimensiunile sunt stocate în `chartDims` (`{ w, h }`); graficul se randează doar când `chartDims` e setat.
  - Container: wrapper `position: relative; width/height 100%` și div observat cu `position: absolute; inset: 0`.
- **Locație**: `apps/web-admin/app/routes/dashboard/components/ActivityTimeline.tsx`.

### 6.4 QuickActionsPanel

- Butoane: Reconcile Webhooks, Check Health, Clear Cache (fără View Logs).
- Loading state pe butoane (spinner pe icon), efecte hover (lift, rotație ușoară icon).
- Tooltip-uri InfoTooltip cu explicații non-tehnice pentru utilizatori noi.
- Grid: `xl:grid-cols-3` (3 butoane).

### 6.5 Animații globale

- În `apps/web-admin/app/globals.css`: `@keyframes fadeSlideUp` (opacity + translateY) și `@keyframes fadeIn` (opacity).

---

## 7. Backend – alte modificări relevante

### 7.1 Serper și xAI health

- **Problema**: decriptare AES-GCM eșua (cheie diferită față de cea cu care au fost criptate cheile în DB) → 500.
- **Soluție**: în `apps/backend-worker/src/services/serper-health.ts` și `xai-health.ts`, apelurile la `decryptAesGcm` sunt în try/catch; la eroare se returnează răspuns controlat (ex. status de eroare) în loc de 500.
- Credențiale în `shop_ai_credentials`; dacă ciphertext-ul e invalid pentru cheia curentă, utilizatorul poate re-introduce cheile din UI.

### 7.2 bulk-lock.ts (queue-manager)

- ESLint: în loc de `||` pentru fallback prefix Redis s-a folosit `??` (nullish coalescing): `process.env['REDIS_PREFIX']?.trim() ?? process.env['BULLMQ_PREFIX']?.trim() ?? ''`.

### 7.3 Test product-detail-drawer

- ESLint: `@typescript-eslint/require-await` – handler-ul `onForceSync` a fost schimbat din `async () => undefined` în `() => Promise.resolve(undefined)`.

---

## 8. Fișiere șterse / ignorate

- **Șterse**: `apps/web-admin/Dockerfile.prebuilt`, `docker-compose.test.yml`.
- **.gitignore**: `.env.infra`, `secrets/`, `vector-agent/data/`.
- **vector-agent**: config `vector-agent/vector.toml` în workspace; `docker-compose.vector-agent.yml` folosește path-uri relative. Directorul `vector-agent/data/` e în .gitignore.

---

## 9. Comandă și path-uri rapide

| Scop | Comandă / path |
| ----- | --------------- |
| Dev hot-reload (hz.164) | `pnpm dev:local` (după `pnpm dev:local:build` la nevoie) |
| Secrets pentru DB tools | `scripts/with-secrets.sh`; fișier implicit: `/run/neanelu-dev/runtime-secrets/api/neanelu-api.env` |
| Migrări / studio | `pnpm db:migrate`, `pnpm db:studio` (rulează prin with-secrets.sh) |
| Restart containere la rotație secrets (dev) | `neanelu-secrets-restart@dev.service` → `infra/scripts/neanelu-secrets-restart.sh` din `/var/www/Neanelu_Shopify` |
| Deploy staging | workflow deploy cu `environment: staging` → SSH deploy@10.0.1.112, `/opt/neanelu`, `deploy.env` |
| Deploy production | workflow deploy cu `environment: production` → SSH deploy@10.0.1.111, `/opt/neanelu`, `deploy.env` |
| Config Traefik dinamic | Orchestrator: `/opt/traefik/dynamic/neanelu.yml` |

---

## 10. Commit-uri (acest chat și anterioare)

- **Branch**: `work/llm-suite-selfhosted`.
- **Commit anterior (chat infrastructură/dashboard)**: `244c6f6` – *feat: hot-reload dev, eliminate .env, dashboard UI enhancements*. Include: hot-reload dev, eliminare .env, OpenBao template derivations, InfoTooltip cu poziționare dinamică, fix Recharts ActivityTimeline, fix serper/xai decryption, eliminare View Logs, docker-compose.dev-local.yml, Dockerfile.dev, with-secrets.sh, vector-agent config, deploy.env în CD, lint fixes (bulk-lock ??, test onForceSync).
- **Commit (chat WebSocket/Queues)**: `ab73f82` – *feat(queues): WebSocket real-time status + @fastify/websocket v11 fix*. Include: fix handler WebSocket pentru @fastify/websocket v11 în queues.ts, bulk.ts, pim-stats.ts și bulk.test.ts; componenta RealtimeQueueStatus; plugin Vite vite.proxy-ws.ts; script TypeScript test-queues-ws.ts; volume mounts pentru config Vite în docker-compose.dev-local.yml; @types/ws.
- **Commit**: `1dd6c3e` – *chore: remove redundant Python WS test script*. Șterge scripts/test-queues-ws.py (înlocuit de test-queues-ws.ts).

---

## 11. Pagina Queues – etichete în română și tooltip-uri

### 11.1 Cerință

- **Pagina**: <https://dev.manager.neanelu.ro/app/queues> (tab Prezentare, tabelul „Queues snapshot”).
- **Problema**: denumirile cozilor în tabel erau tehnice și în engleză (ex. `webhook-queue`, `pim-quality-webhook-sweep`), greu de înțeles pentru utilizatori noi.
- **Cerință**: etichete user-friendly în română pentru fiecare coadă + tooltip-uri detaliate care explică logica fiecărei cozi, bazate exclusiv pe informații reale din cod, limbaj non-tehnic.

### 11.2 Sursa listei de cozi (backend)

- **Lista canonică de nume**: `packages/queue-manager/src/names.ts` – constanta `QUEUE_NAMES`.
- **Lista returnată de API**: în `apps/backend-worker/src/routes/queues.ts`, `DEFAULT_QUEUE_NAMES` = `QUEUE_NAMES` + fiecare nume cu sufixul `-dlq` (cozi DLQ) + `token-health` și `token-health-dlq`.
- Cozile afișate în UI sunt cele returnate de endpoint-ul `/queues` (listQueueSummaries).

### 11.3 Fișier nou: queue-display.ts

- **Locație**: `apps/web-admin/app/utils/queue-display.ts`.
- **Conținut**: tip `QueueDisplayInfo` (`labelRo`, `tooltip`); mapare constantă `QUEUE_DISPLAY` pentru fiecare nume de coadă cunoscut (fără -dlq). Cozile cu sufix `-dlq` sunt tratate în cod: etichetă „Eșecuri: [nume prietenos]”, tooltip dedicat. Funcția `getQueueDisplayInfo(queueName)` returnează labelRo și tooltip; la sfârșitul tooltip-urilor se adaugă „Nume intern: {queueName}.”. Cozi necunoscute: labelRo = queueName, tooltip generic.

### 11.4 Cozi incluse în mapare (nume intern → etichetă RO)

webhook-queue → Notificări Shopify; sync-queue → Sincronizare manuală; bulk-queue → Orchestrator sincronizare în masă; bulk-poller-queue → Verificare status export Shopify; bulk-mutation-reconcile-queue → Reconciliere modificări după bulk; bulk-ingest-queue → Încărcare date bulk; ai-batch-queue → Procesare AI (embedding-uri); pim-enrichment-queue → Îmbogățire date produse (PIM); pim-similarity-search → Căutare potriviri similare; pim-ai-audit → Audit AI potriviri; pim-extraction → Extracție specificații (xAI); pim-scraper-queue → Scraping surse externe; pim-consensus → Consens date produs; pim-quality-webhook → Trimitere notificări calitate; pim-quality-webhook-sweep → Recuperare notificări calitate neefectuate; pim-budget-reset-queue → Reset zilnic buget API; pim-weekly-summary-queue → Rezumat săptămânal costuri; pim-auto-enrichment-scheduler-queue → Programator îmbogățire automată; pim-raw-harvest-retention-queue → Curățare date brute vechi; pim-mv-refresh-queue → Actualizare tabele rezumat; token-health → Verificare token Shopify.

Textele tooltip sunt derivate din workeri și producători din `apps/backend-worker/src/processors/` și `apps/backend-worker/src/queue/`, plus `packages/queue-manager` (bulk.ts, ai.ts, enrichment.ts).

### 11.5 Modificări în queues.tsx

- **Locație**: `apps/web-admin/app/routes/queues.tsx`. **Import**: `getQueueDisplayInfo` din `../utils/queue-display`.
- **Dropdown Queue**: opțiunile au `label` = `getQueueDisplayInfo(q.name).labelRo`, `value` = `q.name`.
- **Tabel Queues snapshot**: coloana Queue = buton cu text `display.labelRo` + `InfoTooltip` cu `display.tooltip`; click pe buton setează coada în URL.
- **Card Coada selectata**: titlu = `getQueueDisplayInfo(selectedQueue).labelRo`, subtitlu cu numele intern în paranteză, InfoTooltip lângă titlu când există selectedQueue.

### 11.6 InfoTooltip

- Folosită cu `maxWidth={420}` pentru tooltip-urile cozilor. Componenta existentă: `apps/web-admin/app/components/ui/info-tooltip.tsx`.

---

## 12. Fix-uri erori (InfoTooltip și markdownlint)

- **InfoTooltip** acceptă doar `side?: 'top' | 'bottom'` (definit în `apps/web-admin/app/components/ui/info-tooltip.tsx`).
- **nav-link.tsx**: `side="right"` a fost înlocuit cu `side="bottom"` la InfoTooltip de lângă link-urile din sidebar.
- **queues.tsx**: la tooltip-ul „Reîncarcă workeri” (tab Workeri) `side="left"` a fost înlocuit cu `side="bottom"`.
- **REZUMAT-CHAT-IMPLEMENTARE-INFRASTRUCTURA.md** (markdownlint): tabelele din §2.1 și §9 – rândurile de separator au fost modificate astfel încât pipe-urile să aibă spațiu în stânga și dreapta (MD060, style compact). URL-ul paginii Queues a fost pus între paranteze unghiulare &lt;...&gt; (MD034, no bare URLs).

---

## 13. Cozi – confirmare funcționalitate și excepție

- **Timp real**: Toate cozile din `DEFAULT_QUEUE_NAMES` sunt incluse în snapshot-ul trimis pe WebSocket; `listQueueSummaries(env)` iterăază peste `DEFAULT_QUEUE_NAMES`, creează un handle BullMQ per nume și apelează `getJobCounts()`. Snapshot-ul se trimite la conectare și apoi la un interval fix (v. secțiunea 14).
- **Endpoint-uri**: Toate rutele din `apps/backend-worker/src/routes/queues.ts` folosesc `isKnownQueueName(name)` (lista = `DEFAULT_QUEUE_NAMES`). Pentru orice nume din listă funcționează: GET /queues, POST pause/resume, DELETE jobs/failed, GET/POST jobs și jobs/:id, GET metrics, POST dlq/replay (doar pentru cozi -dlq), POST jobs/batch.
- **Excepție – pim-scraper-queue**: Coada BullMQ `pim-scraper-queue` este în `QUEUE_NAMES` și apare în API/UI cu toate endpoint-urile valide, dar în `apps/backend-worker` nu există niciun worker care să consume din această coadă (niciun `createWorker` cu `name: 'pim-scraper-queue'`, nici înregistrare în `worker-registry.ts`). Fluxul de scraping din aplicație folosește tabelul din baza de date `scraper_queue` și worker-ul de extracție (extraction worker) care scrie/citește din acel tabel.

---

## 14. Pagina Queues – interval refresh și status „In timp real”

- **Interval refresh**: În `apps/backend-worker/src/routes/queues.ts`, handler-ul WebSocket (`GET /queues/ws`) folosește `setInterval(..., 15_000)` (15 secunde). La fiecare tick se apelează `listQueueSummaries(env)` și se trimite evenimentul `queues.snapshot` cu array-ul de cozi către client.
- **Componenta RealtimeQueueStatus**: Locație `apps/web-admin/app/components/domain/realtime-queue-status.tsx`. Afișează:
  - Când e conectat: badge „In timp real” cu punct verde; text „Ultimul refresh: la HH:mm:ss” (format cu date-fns, locale ro); progress bar care scade de la 100% la 0% pe 15s, cu countdown numeric „Următorul refresh în X s”; la primirea unui snapshot se declanșează o animație scurtă de tip „burst” (dovadă vizuală că refresh-ul e real).
  - Când e deconectat: badge „Offline” și mesaj de eroare dacă există (inclusiv „Autentificare necesară” pentru `session_required`).
- **State în queues.tsx**: `lastSnapshotAt` (timestamp setat la **orice** primire de eveniment `queues.snapshot`, inclusiv snapshot inițial gol sau cu eroare), `countdownRemainingSec` (15 → 0 pe secundă când e conectat, reset la 15 la fiecare snapshot), `showRefreshBurst` (true la snapshot, false după 600 ms). Un `useEffect` rulează un interval de 1s pentru countdown doar când `stream.connected` e true.
- **Animații în globals.css**: `@keyframes queueLivePulse` (2.5s, infinite) – glow ușor pentru badge când e conectat; `@keyframes queueRefreshBurst` (0.6s, o dată) – scalare și inel care se extinde la primirea snapshot-ului. Accesibilitate: `aria-live`, `role="progressbar"`, `aria-valuenow/min/max`, `aria-label` pentru countdown.

---

## 15. Pagina Queues – fix WebSocket „Aștept primul snapshot…” și @fastify/websocket v11

### 15.1 Problema raportată

- După implementarea statusului „In timp real” și a countdown-ului de 15s, UI-ul rămânea blocat pe mesajul „Aștept primul snapshot…”; countdown-ul se reseta dar „Ultimul refresh” nu apărea; nu se primeau mesaje pe WebSocket.

### 15.2 Cauza identificată

- **@fastify/websocket v11** schimbă semnătura handler-ului WebSocket: acesta primește direct **socket**-ul (obiectul WebSocket), nu un obiect `connection` cu proprietatea `connection.socket`. Codul vechi folosea `connection.socket.send()`; în v11 `connection.socket` era undefined, backend-ul loga `missing_socket` și ieșea fără a trimite niciun mesaj.

### 15.3 Modificări backend (apps/backend-worker)

- **queues.ts**: Tipul `WsConnection` a fost înlocuit cu interfața **WsSocket** (reprezentând socket-ul primit direct). Handler-ul rutei `GET /queues/ws` are semnătura `(socket: WsSocket) => { ... }`. Toate apelurile folosesc `socket.send(...)` direct. La deschiderea conexiunii se trimite un snapshot inițial în `setImmediate(...)` cu `sendEvent('queues.snapshot', { timestamp, queues: [], initial: true })` ca primul mesaj să fie trimis după ce upgrade-ul WebSocket este finalizat. La eroare în `sendSnapshot()` se trimite `queues.snapshot` cu `error: 'snapshot_failed'`.
- **bulk.ts** și **pim-stats.ts**: Aceeași adaptare – handler WebSocket primește `(socket: WsSocket)` și folosește `socket.send()` direct. Tipul a fost definit ca `interface WsSocket` (pentru conformitate ESLint consistent-type-definitions).
- **bulk.test.ts**: Tipul mock pentru `StreamBulkLogsWs` a fost actualizat să accepte `socket` în loc de `connection`; cast-uri adecvate pentru compatibilitate cu noul API.

### 15.4 Modificări frontend (apps/web-admin)

- **queues.tsx** – procesare eveniment `queues.snapshot`: `evt.data['queues']` este tratat ca posibil non-array (fallback la array gol). La orice primire de `queues.snapshot` se apelează **setLastSnapshotAt(Date.now())** și **setCountdownRemainingSec(15)** (nu doar când `queues` e array valid), astfel „Ultimul refresh” și countdown-ul se actualizează și la snapshot inițial gol sau la eroare. Lista de cozi se actualizează doar când `!isInitialEmpty` (evită ștergerea listei la snapshot inițial gol).
- **use-queue-stream.ts**: Dacă `getSessionToken()` returnează `null`, se setează `setError('session_required')` și `setConnected(false)` și nu se deschide conexiunea WebSocket (evită încercări inutile și 401). URL-ul WebSocket este construit din `window.location.origin` + calea `/api/queues/ws` și parametrul `token` (fără conectare directă la portul backend, care nu e accesibil din browser).
- **realtime-queue-status.tsx**: Când `error === 'session_required'` se afișează mesajul: „Autentificare necesară (deschide din Shopify Admin sau reîncarcă pagina)”.

### 15.5 Proxy WebSocket în dev (Vite)

- **vite.config.ts**: Regula de proxy pentru `^/api/queues/ws` cu `target` către backend, `ws: true`, `rewriteWsOrigin: true`; plus regula generală `/api` cu `ws: true` și `rewriteWsOrigin: true`. Plugin-ul custom **proxyQueuesWs(backendTarget)** este înregistrat în lista de plugin-uri (înainte de tailwindcss, react, etc.).
- **vite.proxy-ws.ts** (fișier nou): Plugin Vite care interceptează cererile HTTP `upgrade` pe path-ul `/api/queues/ws`. În loc să folosească doar http-proxy-ul Vite, face **pipe TCP direct** către backend: citește `upgrade` pe serverul HTTP al Vite, deschide o conexiune TCP către `backendTarget` (host/port), rescrie linia de request și header-ele (păstrând Host și celelalte), scrie `head` și face pipe bidirecțional socket client ↔ backend. Scop: evitarea pierderii sau blocării mesajelor WebSocket la proxy-ul standard.
- **docker-compose.dev-local.yml**: Serviciul **web-admin-dev** are volume mounts explicite pentru: `./apps/web-admin/vite.config.ts`, `./apps/web-admin/vite.proxy-ws.ts`, `./apps/web-admin/vite.shopify-hmr.ts`, astfel containerul folosește versiunile curente din workspace.
- **apps/web-admin/tsconfig.json**: În `include` au fost adăugate `vite.proxy-ws.ts` și `vite.shopify-hmr.ts` pentru ca ESLint/TypeScript să le recunoască.

---

## 16. Script test WebSocket (test-queues-ws) și curățare

### 16.1 Scop și locație

- Script pentru testare din terminal a conexiunii WebSocket la `/api/queues/ws` și a primirii mesajelor (snapshot-uri) pe o perioadă configurată (ex. 20s). **Locație**: `scripts/test-queues-ws.ts`.

### 16.2 Rulare

- **Comandă**: `pnpm test:queues-ws` → `scripts/with-secrets.sh pnpm tsx scripts/test-queues-ws.ts`. Rulează cu env-ul din OpenBao (implicit `/run/neanelu-dev/runtime-secrets/api/neanelu-api.env`). Variabile opționale: `BASE_WS_URL` (default `http://127.0.0.1:65101`), `SESSION_TOKEN` (dacă lipsește, tokenul este generat din DB + SHOPIFY_API_SECRET).

### 16.3 Implementare (TypeScript)

- **Token**: Dacă `SESSION_TOKEN` nu e setat, scriptul citește din PostgreSQL (prin `DATABASE_URL` sau `MIGRATION_DATABASE_URL`) primul shop și generează un token de sesiune identic cu backend-ul: payload JSON `{ shopId, shopDomain, createdAt }` codat base64url, semnătură HMAC-SHA256 cu `SHOPIFY_API_SECRET`, token = `payload.signature`. Folosește `createHmac` din `node:crypto` și tipul/interfața aliniată cu `SessionData` din backend.
- **Tipuri**: Interfețe definite în fișier: `SessionData`, `QueueSnapshot`, `SnapshotPayload`, `WsMessage`. Pentru mesajele primite pe WebSocket, `WebSocket.RawData` este convertit la string folosind: `Buffer.isBuffer(raw)` → `raw.toString('utf8')`; `raw instanceof ArrayBuffer` → `Buffer.from(raw).toString('utf8')`; `Array.isArray(raw)` → `Buffer.concat(raw).toString('utf8')`; altfel string gol (conform regulii ESLint @typescript-eslint/no-base-to-string).
- **Dependențe**: `pg`, `ws`; **@types/ws** a fost adăugat la workspace root (devDependency) pentru type safety complet. Scriptul este inclus în `tsconfig.eslint.json` (prin `scripts/**/*.ts`) și trece ESLint și typecheck fără dezactivare de reguli.

### 16.4 Fișiere eliminate

- **scripts/test-queues-ws.mjs**: a existat o variantă în JavaScript (.mjs); a fost înlocuită de `scripts/test-queues-ws.ts` și ștearsă din repo.
- **scripts/test-queues-ws.py**: variantă Python care folosea biblioteca `websockets`; raporta eroare Pyright/Based Pyright `reportMissingImports` (Import \"websockets\" could not be resolved). A fost ștearsă ca redundantă – funcționalitatea este acoperită de scriptul TypeScript integrat în toolchain-ul proiectului.

### 16.5 ESLint și commit

- Nu s-au dezactivat reguli ESLint pentru scripturi. Configurația `eslint.config.js` a rămas neschimbată (blocul „SCRIPTS (JS)” acoperă doar `scripts/**/*.js` și `packages/**/scripts/**/*.js`; scriptul de test este `.ts` și este verificat cu regulile TypeScript type-checked prin `tsconfig.eslint.json`). Erori raportate în IDE (ex. @typescript-eslint/no-unsafe-assignment pe `new WebSocket(uri)`) au dispărut după instalarea `@types/ws` și pot persista în IDE din cauza cache-ului serverului ESLint până la „ESLint: Restart ESLint Server”.

---

## 17. Pagina Queues – fix afișare tooltip-uri pe cardurile workerilor (tab Workeri)

### 17.1 Problema raportată

- Pe tab-ul **Workeri** (<https://dev.manager.neanelu.ro/app/queues?queue=webhook-queue&tab=workers>), tooltip-urile de la iconița (i) de lângă numele fiecărui worker nu țineau cont de dimensiunile cardului. Poziționarea tooltip-ului se făcea în funcție de poziția reală a trigger-ului (iconița); dacă acesta nu era centrat în card, tooltip-ul se deplasa lateral (stânga/dreapta) și putea să se ascundă sub cardul vecin, astfel că textul devenea necitibil (informația ajungea în fundalul cardului alăturat).

### 17.2 Cauza

- **InfoTooltip** poziționa tooltip-ul relativ la trigger (align: start/center/end) folosind marginile viewport-ului (`getContentAreaLeft`, `window.innerWidth`), nu marginile cardului workerului. În grid cu carduri alăturate, tooltip-ul putea să iasă din limitele cardului curent și să se suprapună cu cardurile vecine (z-index și overflow făceau ca conținutul să pară „sub" cardul vecin).

### 17.3 Soluție – boundaryRef și portal

- **Componenta InfoTooltip** (`apps/web-admin/app/components/ui/info-tooltip.tsx`):
  - **Prop nou opțional**: `boundaryRef?: React.RefObject<HTMLElement | null>`. Când este furnizat, tooltip-ul se poziționează astfel încât să rămână în interiorul elementului referit (ex. cardul workerului).
  - **Comportament** când `boundaryRef` este setat:
    - Tooltip-ul se randează într-un **portal** (`createPortal(..., document.body)`), cu **position: fixed**, pentru a evita tăieri și stacking context-uri din carduri.
    - La deschidere și la scroll/resize se calculează poziția: se măsoară `getBoundingClientRect()` și pentru trigger și pentru `boundaryRef.current`. **Margini orizontale**: `minLeft = boundaryRect.left + 8`, `maxLeft = boundaryRect.right - maxWidth - 8`. Poziția orizontală a tooltip-ului: `left = clamp(triggerCenter - maxWidth/2, minLeft, maxLeft)`, astfel tooltip-ul rămâne întotdeauna în interiorul dreptunghiului cardului.
    - Poziția verticală: sub trigger (`top = triggerRect.bottom + 10`) pentru `side === 'bottom'`, sau deasupra (`bottom = window.innerHeight - (triggerRect.top - 10)`) pentru `side === 'top'`.
    - Săgeata tooltip-ului rămâne aliniată la trigger: `arrowLeft = clamp(triggerCenter - left, 6, maxWidth - 6)`.
    - Listenere pe `scroll` (capture) și `resize` pe `window` actualizează poziția cât timp tooltip-ul este deschis.
  - **Când `boundaryRef` nu e furnizat**: comportamentul rămâne neschimbat (poziționare absolută relativă la trigger, cu align start/center/end pe viewport).
  - **Evitare flash**: dacă `boundaryRef` este furnizat, varianta cu poziționare absolută (în flux) nu se mai randează; tooltip-ul apare doar când poziția în portal a fost calculată (`portalPosition != null`), astfel nu se afișează niciodată în poziție greșită sub cardul vecin.

### 17.4 Modificări în WorkersGrid

- **Locație**: `apps/web-admin/app/components/domain/workers-grid.tsx`.
- **Componentă nouă**: **WorkerCard** – fiecare card de worker este randat de acest component, care folosește un **ref pe `<article>`** (`useRef<HTMLElement>(null)`). Acest ref este pasat la **InfoTooltip** ca **boundaryRef**, astfel tooltip-ul de la iconița (i) rămâne în limitele cardului respectiv.
- **WorkersGrid**: nu mai conține logica cardului în `.map()`; mapează lista de workeri la `<WorkerCard key={w.id} worker={w} index={index} display={getWorkerDisplayInfo(w.id)} />`. Ref-ul este creat în WorkerCard (un ref per instanță de card), conform regulilor hooks (fără apel de hook în interiorul `.map()`).

### 17.5 Rezultat

- La hover/focus pe iconița (i) de lângă numele unui worker, tooltip-ul se afișează în viewport (portal, z-index 9999), cu `left` limitat la lățimea cardului, deci nu se extinde sub cardurile alăturate; textul rămâne citibil deasupra conținutului și nu se ascunde în fundalul cardului vecin.

---

Acest document reflectă starea **curentă** a implementării și infrastructurii în zonele acoperite de chat-urile de implementare (infrastructură, dashboard, Queues, WebSocket, scripturi). Nu este un inventar exhaustiv al fiecărui fișier din repo; pentru schema DB, tabele și coloane vezi migrările Drizzle și documentația de audit existentă.
