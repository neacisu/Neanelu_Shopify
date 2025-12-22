# **Plan Implementare Tehnică DevOps: Shopify Enterprise (1M+ SKU)**

**Stack:** Node.js v24 (LTS), PostgreSQL 18.1, Redis 8.4.0, BullMQ Pro **Package Manager:** pnpm (Strict Enforcement) **Abordare:** Infrastructure-First \-\> Data Layer \-\> Logic \-\> Observability

---

## **Addendum (Dec 2025): Descoperiri validate în research (TypeScript)**

Acest document descrie un plan DevOps „target-state”. În research am validat practic, în TypeScript (rulat cu `pnpm exec tsx`), un set de constrângeri concrete în jurul Shopify Admin GraphQL + Bulk Operations care trebuie reflectate în implementare.

### **A. Auth Admin GraphQL în mediu headless**

* Shopify CLI login poate fi instabil/blocat pe headless Linux. În research a fost necesar un flow OAuth manual (captură `code` + exchange la `/admin/oauth/access_token`) pentru a obține token.
* Implicație: în producție implementăm OAuth server-side (start/callback + state/HMAC) și persistăm token-urile criptat (DB + secret manager), fără dependență de CLI.

### **B. Bulk Operations JSONL: streaming + stitching**

* Exportul Bulk Ops produce JSONL mare, cu linii `Product` și `ProductVariant` separate.
* Legarea variantelor la produs se face prin `__parentId` (variant → product). Pipeline-ul trebuie să reconcilieze relațiile în streaming (nu presupunem nesting complet).

### **C. Limitare: app-owned metafields**

* Metafield-urile de tip `app--<id>--...` sunt vizibile doar în contextul aplicației owner; cu token de staff/Admin pot apărea ca goale.
* Implicație: dacă avem nevoie de aceste namespace-uri, le citim prin token-ul aplicației owner sau le replicăm în DB într-un flux controlat.

### **D. Determinism pentru debugging/parity**

* Sampling-ul (vendor/produs) folosit în pipeline-urile de verificare trebuie să fie deterministic (fără random), ca să evităm drift între rulari.

## **Preambul: Standarde DevOps și Tooling**

Înainte de a scrie prima linie de cod de business, se stabilesc standardele proiectului.

* **Engine Locking:** Forțarea versiunilor în package.json ("engines": { "node": "\>=24.0.0", "pnpm": "\>=10.0.0" }).  
* **Monorepo vs Polyrepo:** Având în vedere complexitatea (Frontend Admin, Backend API, Worker Service), se recomandă o structură **Monorepo** gestionată prin pnpm workspaces.

### **0.x. Secrets management & promovare dev/staging/prod**

* Livrează `.env.example` cu variabile obligatorii (SHOPIFY_API_KEY/SECRET/SCOPES, POSTGRES_URL, REDIS_URL, BULLMQ_PRO_TOKEN, NPM_TASKFORCESH_TOKEN, OPENAI_API_KEY, ENCRYPTION_KEY_256, APP_HOST, OTEL_EXPORTER_OTLP_ENDPOINT). `.env` rămâne în .gitignore; nu se comite niciun secret.
* Dev: fișier `.env.local` neversionat; Staging/Prod: secrete în OpenBAO (self-hosted, Docker), injectate în runtime prin OpenBAO Agent (template → env-file) și folosite de containere. CI declanșează deploy; .npmrc trebuie să folosească `${NPM_TASKFORCESH_TOKEN}` (nu token hardcoded) pentru registry-ul privat BullMQ Pro.
* Rotație și audit: rotație trimestrială pentru Shopify tokens, BullMQ Pro, OpenAI, chei AES. Accesul la secret manager este auditat; nu se expediază secrete prin Slack/Email. Backup plan pentru rotație eșuată (rollback token precedent) documentat.

### **0.x.1. Checklist Onboarding Developer**

Un developer nou trebuie să parcurgă următorii pași pentru a putea contribui la proiect:

1. **Obținere acces NPM_TASKFORCESH_TOKEN:**
   * Solicită invitație la contul organizației pe [taskforce.sh](https://taskforce.sh)
   * Generează token personal după acceptarea invitației
   * Adaugă token-ul în fișierul `.env.local` (nu `.env`)

2. **Configurare mediu local:**
   * Copiază `.env.example` → `.env.local`
   * Populează toate variabilele obligatorii (SHOPIFY_API_KEY, POSTGRES_URL, etc.)
   * Rulează `pnpm run db:up` pentru a porni Docker containers

3. **Verificare acces registry privat:**
   * Rulează `pnpm install` - trebuie să descarce `@taskforcesh/bullmq-pro` fără erori
   * Dacă primești 401/403: verifică token-ul în `.npmrc` sau `.env.local`

4. **Configurare Shopify dev store:**
   * Creează dev store pe [partners.shopify.com](https://partners.shopify.com)
   * Instalează aplicația via `pnpm run shopify:dev`
   * Obține scopes necesare (read_products, write_products, etc.)

### **0.y. OpenBAO & Secrets Architecture (Self-Hosted)**

* **Setup:** OpenBAO rulează ca container Docker (`openbao/openbao:latest`) pe rețeaua internă, cu un volum criptat pentru date.
* **Initialization:** La prima rulare, se face `bao operator init` pentru a genera cheile de unseal și root token. Cheile de unseal sunt distribuite la 3 admini diferiți (Shamir's Secret Sharing).
* **Auto-Unseal Strategy (Production):**
  * OpenBAO este configurat cu auto-unseal folosind o cheie externă stocată pe un HSM sau un serviciu extern (ex: Shamir unseal cu 3 chei distribuite la admini diferiți, sau transit unseal cu un alt OpenBAO instance dedicat sealing).
  * La restart sau failover, un script de infrastructură (`bao-unseal.sh`) rulează automat de către systemd (after=docker.service) pentru a aplica cheile de unseal din locații protejate (ex: fișier criptat cu parolă sau SmartCard).
  * Alertă automată: Dacă OpenBAO rămâne sealed > 5 minute după restart, se trimite notificare pe canalul de on-call.
  * **Runbook:** `Docs/runbooks/openbao-recovery.md` documentează pașii manuali de unseal în caz de eșec automat.
* **Deploy Flow:**
    1. Pipeline-ul CI construiește imaginea aplicației (fără secrete).
    2. Pe serverul bare-metal, `docker-compose.yml` include un serviciu sidecar (OpenBAO Agent) sau folosește un `init-container`.
    3. Agentul se autentifică la OpenBAO (prin AppRole), citește secretele din calea corespunzătoare (`secret/data/neanelu/prod`) și randează un fișier `.env` temporar în memorie sau într-un volum tmpfs.
    4. Aplicația pornește având acces la variabilele din acest fișier via `--env-file`.
* **Safety:** Fișierul `.env` nu persistă pe disc după restart și nu ajunge niciodată în logs sau git.

## **Faza 1: Bootstrapping și Configurare Mediu Local (Săptămâna 1\)**

> **Notă corespondență faze:** Acest document folosește numerotare Faza 1-7. Maparea către `Plan_de_implementare.md`: Faza 1 ≈ F0+F1, Faza 2 ≈ F2, Faza 3 ≈ F3, Faza 4 ≈ F4, Faza 5 ≈ F5, Faza 6 ≈ F6, Faza 7 ≈ F7.

**Obiectiv:** Un mediu de dezvoltare reproductibil ("It works on my machine" \-\> "It works in the container").

### **1.1. Inițializare Monorepo și pnpm**

* Configurare pnpm-workspace.yaml pentru a separa aplicațiile (apps/web-admin, apps/backend-worker) de pachetele partajate (packages/database, packages/config, packages/types).  
* **Acțiune:**  
  `pnpm init`  
  `pnpm add -w -D typescript @types/node eslint prettier turbo`  
  `# Configurare 'shamefully-hoist=true' în .npmrc pentru compatibilitate framework-uri legacy dacă e cazul`

### **1.2. Containerization (Infrastructure as Code \- Local)**

Nu instalăm Postgres sau Redis local pe mașină. Totul rulează în Docker.

* Creare docker-compose.dev.yml:  
  * **PostgreSQL 18.1 Service:** Montare volum pentru date, configurare command pentru optimizări JSONB.  
  * **Redis 8.4.0 Service:** Folosește imaginea `redis:8.4` cu module RediSearch și RedisJSON **integrate nativ** (din Redis 8.0), nu mai e nevoie de redis-stack. Persistență AOF.  
  * **Adminer/PgAdmin:** Pentru inspecție vizuală rapidă.  
* **Livrabile:** Comanda pnpm run db:up ridică infrastructura în \< 5 secunde.

### **1.x. Topologie Staging/Prod (Bare Metal)**

Pentru a susține volumul de 1M+ SKU și procesarea asincronă, arhitectura de producție este dimensionată explicit:

* **Host:** Server Bare Metal (ex: Hetzner AX line / OVH) cu NVMe RAID, 64GB+ RAM.
* **Rețea:**
  * `public_net`: Doar Traefik (Reverse Proxy) expus la port 80/443.
  * `internal_net`: Toate celelalte servicii, izolate de internet.
* **Containere & Scaling:**
  * **PostgreSQL 18.1**: Instanță unică (Primary), optimizată pentru scriere (NVMe).
  * **Redis 8.4**: Instanță unică sau Cluster, memorie dedicată pentru cozi și cache.
  * **API Server (`backend-worker` web mode)**: 2-4 replici pentru disponibilitate HTTP.
  * **Worker (`backend-worker` job mode)**: Scalat la **10 instanțe** (`--scale worker=10`).
    * Acest număr de 10 workeri permite o concurență de procesare de 50-100 joburi simultane (în funcție de `MAX_GLOBAL_CONCURRENCY`), maximizând throughput-ul fără a bloca event loop-ul Node.js.
* **Docker Health Check Configuration (Prod):**
  * **API Server:**

    ```yaml
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health/ready"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 30s
    ```

  * **Worker:** (verifică conexiunea Redis + stare internă)

    ```yaml
    healthcheck:
      test: ["CMD", "node", "-e", "require('./health-check.js').check()"]
      interval: 30s
      timeout: 10s
      retries: 2
      start_period: 60s
    ```

  * **PostgreSQL:**

    ```yaml
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $POSTGRES_USER -d $POSTGRES_DB"]
      interval: 10s
      timeout: 5s
      retries: 5
    ```

  * **Redis:**

    ```yaml
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3
    ```

* **Database Pool Sizing:**
  * Formula: `Total Connections = (API_Replicas * API_POOL) + (Worker_Replicas * WORKER_POOL) + Overhead`
  * Configurare recomandată pentru 10 Workeri:
    * `DB_POOL_SIZE` per Worker = 5
    * `DB_POOL_SIZE` per API = 10
    * Total estimat: `(4 * 10) + (10 * 5) = 90` conexiuni active + overhead migrații/admin = ~100 conexiuni (mult sub limita default Postgres de 100, dar scalabil până la 500-1000 cu tuning).

### **1.2.x. TypeScript Bootstrap (Prerequisite pentru 1.3)**

Înainte de configurarea Git Hooks, TypeScript trebuie inițializat pentru ca `pnpm lint` și `pnpm typecheck` să funcționeze.

* **Acțiune:**  
  `pnpm add -wD typescript @types/node tsx`
* **Creare tsconfig.base.json:**
  * `target`: `ES2024` (aliniat cu Node.js 24)
  * `module`: `NodeNext` (ESM nativ)
  * `moduleResolution`: `NodeNext`
  * `strict`: `true`
  * `paths`: maping pentru `@app/*` packages
* **Fiecare package/app** va avea propriul `tsconfig.json` care extinde `tsconfig.base.json`
* **ESM Contract:** Fișierul `package.json` al fiecărui package are `"type": "module"` și `"exports"` explicite

> **Notă:** Folosim exclusiv **TypeScript ^5.9.0** - versiunea stabilă curentă (decembrie 2025).

### **1.3. Standardizare Git Hooks**

* Configurare husky și lint-staged.  
* Pre-commit hook: Rulează pnpm lint și verifică tipurile TypeScript.  
* Pre-push hook: Rulează teste unitare: **backend** pe `node --test` (apps/backend-worker), **frontend** pe `pnpm --filter @app/web-admin test` (Vitest). Jest nu se folosește.

### **1.4. CI/CD "skeleton" devreme (Week 1)**

* Scop: prinde incompatibilități ESM/monorepo și probleme de packaging înainte de F7.  
* Configurează un workflow GitHub Actions minimal pe PR: checkout, setup pnpm cu cache, pnpm install, pnpm lint, pnpm typecheck, pnpm test (backend cu `node --test`, frontend cu Vitest), artefacte junit/coverage.  
* Adaugă job de smoke build Docker (multi-stage) fără publish, doar pentru a confirma că Dockerfile funcționează cu pnpm workspaces și că se construiește aplicația.  
* Rulează scanare rapidă (ex. trivy fs) pe PR pentru a surprinde devreme CVE-uri majore; scanarea imaginii completă rămâne în F7.

## **Faza 2: Data Layer și Schema Design (Săptămâna 2\)**

**Obiectiv:** Stabilirea sursei de adevăr. Fără logică de aplicație, doar structură de date și securitate.

### **2.1. Configurare ORM/Query Builder (Pachetul packages/database)**

Recomandare: **Drizzle ORM** (standardul proiectului), conectat la containerul Postgres.

* **Acțiune:**  
  `pnpm --filter @app/database add drizzle-orm@0.45.1 pg pg-copy-streams stream-json`  
  `pnpm --filter @app/database add -D drizzle-kit@0.31.8 @types/pg`
  
  **Notă:** Folosim `pg` (node-postgres), NU `postgres` (postgres-js), deoarece:
  * `pg-copy-streams` (necesar pentru COPY FROM STDIN) funcționează doar cu `pg`
  * COPY FROM STDIN este esențial pentru ingestie 1M+ produse la zeci de mii/secundă

### **2.2. Definirea Schemei și Migrații Initiale**

* Crearea tabelului shops (tenants).  
* Crearea tabelului products cu coloane hibride: id (uuid cu DEFAULT uuidv7()), shopify\_id (bigint, indexat), metafields (jsonb, GIN index).  
* **Critic:** Scrierea migrației SQL native pentru activarea **Row Level Security (RLS)**.  
  * *Task:* Crearea politicii CREATE POLICY tenant\_isolation ... care forțează shop\_id.
  * *Disciplina conexiunilor:* Orice request/worker care folosește pool `pg` trebuie să intre în tranzacție și să execute `SET LOCAL app.current_shop_id = $shopId::uuid;` înaintea oricărei interogări; la fiecare checkout din pool se setează din nou (nu se reutilizează conexiuni „calde” fără re-setare). (**Notă:** Cast-ul e `::uuid`, NU `::UUIDv7` - tipul PostgreSQL e 'uuid', chiar dacă valoarea e UUIDv7.) Adaugă un test de integrare care verifică că două cereri consecutive cu shop-uri diferite nu „leak-uiesc” date (ex.: primul `SET LOCAL` + SELECT, apoi alt shop trebuie să fie izolat).

### **2.3. Seed Scripts**

* Crearea unui script pnpm run db:seed care populează baza de date cu 10.000 de produse sintetice (folosind faker) pentru a testa performanța indexării JSONB înainte de a conecta API-ul Shopify.

## **Faza 3: Core Backend & Shopify Auth (Săptămâna 3\)**

**Obiectiv:** Conectivitate securizată. Serviciul HTTP (apps/backend-worker).

**Notă:** Serviciul HTTP principal (OAuth, webhooks, API) este în `apps/backend-worker`. Aplicația `apps/web-admin` este opțională și destinată exclusiv interfeței de administrare.

### **3.1. Server Setup (Node.js v24)**

* Inițializare server (Fastify sau Hono pentru performanță, sau Remix dacă se folosește șablonul Shopify App).  
* Configurare pnpm pentru a importa tipurile partajate din packages/database.

### **3.2. Implementare OAuth 2.0 (Offline Access)**

* Implementarea fluxului de autentificare Shopify.  
* **Stocare Sesiuni:** Configurarea adaptorului de sesiune pentru a scrie token-urile criptate în PostgreSQL (nu în memorie), folosind RLS.  
* **Token Rotation:** Implementarea middleware-ului care verifică expirarea token-ului offline și declanșează refresh-ul proactiv.

### **3.3. Webhooks Ingress**

* Crearea endpoint-ului /api/webhooks.  
* Validarea semnăturii HMAC (folosind crypto nativ din Node).  
* **Important:** Endpoint-ul doar validează și trimite mesajul în Redis (Producer). Nu procesează nimic. Returnează 200 OK instant.

### **3.4. Observabilitate HTTP & Webhooks (OTel early)**

* Activează OpenTelemetry în apps/backend-worker pentru HTTP server și handlerul /api/webhooks: trace-uri cu shop_id/request_id, loguri structurate corelate (traceId/spanId), sampling redus (≈10%) către Jaeger din docker-compose.  
* Asigură fallback silențios dacă exporterul lipsește și verifică în Jaeger fluxul Shopify request → enqueue Redis.

## **Faza 4: Asynchronous Processing Infrastructure (Săptămâna 4\)**

**Obiectiv:** "The Engine". Configurare BullMQ Pro și Worker Service (apps/backend-worker).

### **4.1. Configurare BullMQ Pro**

* Instalare dependențe: pnpm \--filter @app/backend-worker add bullmq.  
* Instanțierea cozilor principale: sync-queue, webhook-queue, bulk-queue, ai-batch-queue.

### **4.2. Implementarea "Fairness" (Multi-tenant Isolation)**

* Configurarea Worker-ului pentru a folosi strategia **Groups**.  
* Maparea shop_id (UUIDv7) la groupId (shop_domain rămâne doar pentru logging/traces).  
* Setarea limitelor de concurență (ex: max 2 job-uri active per shop, dar 50 global).

### **4.3. Rate Limiting Distribuit (Redis Lua Scripts)**

* Implementarea unui serviciu care interoghează Redis pentru a verifica "bugetul" de API al magazinului înainte de a prelua un job.  
* Logicǎ de Backoff: Dacă Shopify returnează 429, job-ul intră automat în starea delayed pentru X secunde.

### **4.4. Observabilitate Cozi & Worker (BullMQ + OTel)**

* Instrumentează cozi și worker: spans pentru enqueue/dequeue/process cu atribute groupId/shop_domain, metrice (latență job, active, failed, retry).  
* Loguri corelate cu traceId pentru erori/retry; alerte pe retry rate și stări stalled.

## **Faza 5: Pipeline-ul de Ingestie "Stitched" (Săptămâna 5-6)**

**Obiectiv:** Implementarea logicii complexe de Bulk Operations folosind Streams.

### **5.1. Mutation Service (Bulk Setup)**

* Dezvoltarea funcției care sparge un request masiv în 3 operațiuni bulkOperationRunQuery secvențiale (Core \-\> Meta \-\> Inventory).  
* State management în Redis: Urmărirea stării celor 3 operațiuni pentru fiecare magazin.

### **5.2. Streaming Implementation (Node.js v24 Streams)**

* Implementarea apps/backend-worker/processors/bulk-processor.ts.  
* Utilizarea fetch nativ pentru a lua JSONL-ul.  
* Pipe-uirea stream-ului printr-un TransformStream care curăță datele.  
* Pipe-uirea finală către pg-copy-streams pentru inserare directă în PostgreSQL.  
* **Testare:** pnpm test pe un fișier JSONL local de 1GB pentru a valida memoria (trebuie să stea sub 500MB RAM).

### **5.3. Observabilitate Pipeline Bulk/Streaming**

* Spans pentru etapele download → parse → transform → COPY, metrice (bytes procesați, rânduri/s, erori pe chunk, backlog ingestie).  
* Loguri structurate cu traceId/spanId pentru a depista blocaje/OOM devreme; export către Jaeger în dev/staging.

## **Faza 6: Integrare AI & Vector Search (Săptămâna 7\)**

**Obiectiv:** Adăugarea inteligenței peste datele existente.

### **6.1. OpenAI Batch Integration**

* Cron job care scanează produsele noi/modificate din DB.  
* Generarea fișierului JSONL pentru OpenAI Batch API.  
* Worker care verifică statusul batch-ului și descarcă rezultatele (embeddings) după 24h.

### **6.2. Redis Vector Search**

* Crearea indexului în Redis 8.4 (FT.CREATE ... SCHEMA content\_vector VECTOR HNSW ...).  
* Sincronizarea vectorilor din Postgres (cold storage) în Redis (hot cache) pentru interogări active.

## **Faza 7: CI/CD, Observabilitate și Producție (Săptămâna 8\)**

**Obiectiv:** Hardening pentru producție; extinderea skeleton-ului deja activ în F1 cu build/publish și observabilitate completă.

### **7.1. OpenTelemetry (Otel)**

* Instrumentarea aplicației (apps/web-admin și apps/backend-worker) cu SDK-ul OpenTelemetry pentru Node.js.  
* Urmărirea fluxului: HTTP Request (Shopify) \-\> Redis Queue \-\> Worker Process \-\> Postgres Query.

### **7.2. Docker Multi-stage Builds**

* Optimizarea Dockerfile pentru producție.  
* Stage 1: pnpm install & pnpm build (cu devDependencies).  
* Stage 2: Copierea build-ului și pnpm install \--prod (doar dependencies).  
* Imagine finală minimală (Alpine/Debian-slim).

### **7.3. GitHub Actions Pipelines**

* **CI Pipeline (extinde skeleton-ul din F1):**  
  1. Checkout.  
  2. Setup Node & pnpm + Cache.  
  3. Lint & Typecheck.  
  4. Unit & Integration Tests (cu containere efemere Postgres/Redis).  
  5. Scanări complete (trivy image, dep scan).  
* **CD Pipeline (Bare Metal / Self-Hosted):**  
  1. Build Docker Image (multi-stage, Alpine).  
  2. Push to Registry (GHCR sau self-hosted registry).  
  3. SSH Deploy către server bare-metal:  
     * `docker compose pull` pentru noile imagini  
     * `pnpm run db:migrate` (conexiune separată cu rol migrator)  
     * `docker compose up -d --remove-orphans` cu zero-downtime (health checks)  
     * Rollback automat dacă health check eșuează (păstrează imaginea anterioară)

## **Rezumat Comenzi Cheie (Developer Experience)**

| Comanda | Descriere |
| :---- | :---- |
| pnpm i | Instalează dependențele în tot monorepo-ul. |
| pnpm dev | Pornește containerele, web server-ul și workerii în watch mode. |
| pnpm db:up | Ridică doar infrastructura (Docker). |
| pnpm db:studio | Deschide GUI-ul pentru baza de date (Drizzle Studio). |
| pnpm test:load | Rulează teste de încărcare simulate locale. |
