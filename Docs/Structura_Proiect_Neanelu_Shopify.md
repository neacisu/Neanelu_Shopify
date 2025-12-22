# **Structura Directoare Neanelu\_Shopify (Enterprise Architecture)**

<!-- markdownlint-disable MD004 -->

---

## **Notă importantă (Dec 2025): Target-state vs starea curentă a repo-ului**

Documentul de mai jos descrie structura recomandată „enterprise/target-state” (monorepo pnpm cu `apps/*` și `packages/*`). În starea curentă a acestui repo, partea implementată/validată este zona de research (scripturi TypeScript rulate cu `pnpm exec tsx`), folosită pentru:

- export Bulk Operations (JSONL) + procesare streaming;
- sampling determinist vendor/produs pentru reproducibilitate;
- „TOT / fetch everything” pe Product prin schema introspection + paginare metafields;
- validarea limitărilor (ex: app-owned metafields).

Recomandare: păstrăm structura de mai jos ca „țintă”, dar menținem explicit și structura de research până când codul este migrat în `apps/backend-worker`/`packages/shopify-client`.

Această structură este un **Monorepo pnpm** proiectat pentru a gestiona volume masive de date. Adâncimea directoarelor ajunge până la nivelul 8 în zonele critice (ex: pipeline-ul de ingestie Bulk Operations și strategiile de Fairness Queuing), pentru a izola logica complexă și a facilita debugging-ul.

### **📌 Layout research (implementat și validat în TS)**

- **/Research/bulk-products.jsonl** (artefact Bulk Ops; foarte mare; nu se comite)
- **/Research/Scripts/TScripts/** (scripturi TypeScript; execuție: `pnpm exec tsx <script>.ts`)
- **/Research/TSOutputs/** (output-uri generate; nu se comit)
- **/Research/Outputs/** (output-uri Python, dacă există; nu se comit)
- **.env.txt / Research/.env.txt** (secrete locale folosite în research; nu se comit)

## **📂 Nivel 0: Rădăcina Proiectului (Root)**

### **/Neanelu\_Shopify**

* **.npmrc** (Configurare critică pentru shamefully-hoist=true și registry privat Taskforce.sh pentru BullMQ Pro)  
* **.env.example** (șablon cu variabile obligatorii; .env este ignorat și nu se comite; valorile reale vin din Secret Manager/CI)  
* **pnpm-workspace.yaml** (Definirea workspace-urilor: apps/\* și packages/\*)  
* **package.json** (Scripturi globale: dev, build, test, lint)  
* **turbo.json** (Orchestrare build pipeline \- opțional, recomandat pentru monorepo)  
* **.nvmrc** (Conține: v24.12.0 \- LTS Krypton)  
* **docker-compose.yml** (Servicii locale: Postgres 18.1, Redis 8.4.0, Jaeger pentru OpenTelemetry)

## **📂 Nivel 1: Pachete Partajate (/packages)**

Aceste pachete sunt dependințe interne folosite de aplicații.

### **📦 /packages/database (PostgreSQL 18.1 \+ Drizzle ORM)**

Responsabil pentru stratul de persistență hibrid (Relațional \+ JSONB).

* /drizzle  
  * /migrations (SQL migrations generate/aplicate cu drizzle-kit)  
* /src  
  * /db.ts (Instanțierea conexiunii + client Drizzle)  
  * /middleware/session-guard.ts (setează `SET LOCAL app.current_shop_id` per tranzacție/request pentru conexiunile din pool, prevenind leak-ul de tenant context)  
  * /schema.ts (SQL schema declaration Drizzle pentru Shop, Product, Metaobject etc.)
  * /extensions  
    * jsonb-optimization.ts (Helperi pentru compresie/interogare JSONB PG18 (18.1))  
  * /streaming  
    * pg-copy-streams.manager.ts (Wrapper peste pg-copy-streams pentru ingestie rapidă)  
    * README.md (Explicație pipeline COPY FROM STDIN)

* drizzle.config.ts (config pentru drizzle-kit: dialect, schema path, migrations out)

### **📦 /packages/queue-manager (BullMQ Pro \+ Redis 8.4.0)**

Responsabil pentru cozi, fairness și rate limiting.

* /src  
  * /config  
    * redis-connection.ts (Configurare ioredis cu suport Cluster)  
  * /factories  
    * queue.factory.ts (Creare cozi standardizate)  
    * worker.factory.ts (Creare workeri cu logging integrat)  
  * /strategies  
    * /fairness  
      * group-strategy.ts (Implementare BullMQ Groups pentru izolare multi-tenant)  
      * rate-limiter.lua (Script Lua custom pentru Redis 8.4.0)  
  * /types  
    * job-types.ts (Definire structuri payload: BulkOperationJob, WebhookJob)

### **📦 /packages/shopify-client**

Wrapper peste API-ul Shopify (Admin GraphQL 2025-10).

* /src  
  * /graphql  
    * /queries  
      * bulk-operation-run-query.ts  
    * /mutations  
      * staged-uploads-create.ts  
  * /auth  
    * token-exchange.ts (Rotare tokenuri offline)  
    * session-storage.ts (Custom Redis session storage)

### **📦 /packages/ai-engine**

Logica pentru Vector Search și OpenAI Batch API.

* /src  
  * /openai  
    * batch-client.ts (Manager pentru fișiere .jsonl OpenAI)  
  * /vectors  
    * /redis  
      * schema-definition.ts (Schema RediSearch)  
      * semantic-cache.ts (Implementare CESC \- Context Enabled Semantic Cache)

### **📦 /packages/config**

Parsare și validare configurație/env centralizată pentru toate aplicațiile.

* /src  
  * env.ts (Schema și validare variabile de mediu obligatorii)  
  * index.ts (Export config tipizat pentru consum în apps)

### **📦 /packages/types**

Tipuri TypeScript partajate cross-workspace pentru consistență.

* /src  
  * index.ts (Barrel export)  
  * shopify.ts (Tipuri pentru entități Shopify: Product, Variant, Metafield)  
  * jobs.ts (Tipuri pentru payloads BullMQ: WebhookJob, BulkJob, SyncJob)  
  * database.ts (Tipuri derivate din schema Drizzle)

### **📦 /packages/logger**

Logging structurat + wrappers OpenTelemetry pentru observabilitate unificată.

* /src  
  * index.ts (Logger principal cu redactare PII)  
  * otel-correlation.ts (Corelare loguri cu traceId/spanId)  
  * redact.ts (Redactare automată token-uri, Authorization, cookies)

## **📂 Nivel 1: Aplicații (/apps)**

### **🚀 /apps/web-admin (Frontend \- React Router v7)**

Interfața admin embedded în Shopify.

* /app  
  * /routes (File-based routing RR7)  
    * \_index.tsx (Dashboard principal)  
    * app.products.tsx (Lista produse virtuale)  
  * /components  
    * /polaris-wrappers (Componente native Polaris Web Components)  
  * /shopify.server.ts (Configurare App Bridge Backend)  
* /public (Assets statice)  
* vite.config.ts (Configurare Vite cu plugin-uri Shopify și RR7)

### **⚙️ /apps/backend-worker (Procesor Asincron \- Node.js v24)**

"Motorul" aplicației. Aici se întâmplă procesarea grea.

#### **Structură Detaliată Nivel 3-8 pentru Worker:**

* /src  
  * main.ts (Entry point, inițializare OpenTelemetry)  
  * /processors **(Nivel 3\)**  
    * /webhooks **(Nivel 4\)**  
      * /handlers  
        * products-update.handler.ts  
        * app-uninstalled.handler.ts  
    * /bulk-operations **(Nivel 4\)**  
      * /pipeline **(Nivel 5\)**  
        * /stages **(Nivel 6\)**  
          * /download  
            * stream-downloader.service.ts  
          * /parsing **(Nivel 7\)**  
            * /jsonl  
              * stream-json-parser.ts (Wrapper stream-json)  
          * /transformation **(Nivel 7\)**  
            * /stitching **(Nivel 8\)**  
              * parent-child-remapper.ts (Re-asociere variante la produse)  
              * metafield-flattener.ts (Pregătire pentru JSONB)  
          * /ingestion **(Nivel 7\)**  
            * postgres-copy.service.ts (Scriere directă în DB via stream)  
  * /schedulers  
    * token-refresh.cron.ts (Job periodic pentru verificare token-uri)  
  * /monitoring  
    * otel-setup.ts (Configurare Tracing și Metrics exporter)

## **📂 Explicarea Fișierelor Cheie (Placeholders)**

### **📄 /Neanelu\_Shopify/.npmrc**

`# Configurare pentru compatibilitate React Router 7 și Shopify Vite Plugins`  
`shamefully-hoist=true`  
`auto-install-peers=true`  
`engine-strict=true`

`# Registru privat pentru BullMQ Pro`  
`@taskforcesh:registry=[https://npm.taskforce.sh/](https://npm.taskforce.sh/)`  
`//npm.taskforce.sh/:_authToken=${NPM_TASKFORCESH_TOKEN}`

### **📄 /Neanelu\_Shopify/packages/database/src/extensions/jsonb-optimization.ts**

`/**`  
 `* Utilitar pentru PostgreSQL 18.1 JSONB.`  
 `* PostgreSQL 18.1 introduce compresie avansată pentru JSONB.`  
 `* Acest modul asigură că interogările folosesc operatorii corecți (@>, ?, ?&)`  
 `* pentru a beneficia de indecșii GIN.`  
 `*/`  
`export const jsonbOptimize = (query: any) => {`  
  `// Logică de transformare a filtrelor frontend în sintaxă PG JSONB`  
  `// TODO: Implementare mapare filtre dinamice`  
`};`

### **📄 /Neanelu\_Shopify/apps/backend-worker/src/processors/bulk-operations/pipeline/stages/transformation/stitching/parent-child-remapper.ts**

`/**`  
 `* NIVEL 8: Modul de Stitching (Coasere) date.`  
 `*`  
 `* Deoarece Bulk API returnează datele "plate" în JSONL (linii separate pentru părinte și copil),`  
 `* dar PostgreSQL le stochează relațional sau în documente imbricate,`  
 `* acest TransformStream reține contextul părintelui curent în memorie`  
 `* (buffer mic) pentru a asocia variantele corecte.`  
 `*`  
 `* Strategie:`  
 `* 1. Detectare linie 'Product' -> Setare Context ID.`  
 `* 2. Detectare linie 'Variant' -> Adăugare parent_id din context.`  
 `* 3. Push către stream-ul de scriere DB.`  
 `*/`  
`import { Transform } from 'node:stream';`

`export class ParentChildStitcher extends Transform {`  
    `// Implementare stream transform`  
`}`

### **📄 /Neanelu\_Shopify/packages/queue-manager/src/strategies/fairness/group-strategy.ts**

`/**`  
 `* Implementare BullMQ Pro Groups.`  
 `* Asigură că un magazin cu 1M produse nu blochează un magazin cu 10 produse.`  
 `*`  
 `* Fiecare job primește un 'groupId' egal cu 'shop_id' (UUIDv7 - aliniat cu RLS).`  
 `* shop_domain rămâne doar atribut de logging/tracing, nu identity.`  
 `* Workerii consumă job-uri în mod Round-Robin între grupuri.`  
 `*/`  
`import { WorkerOptions } from 'bullmq';`

`export const getFairnessOptions = (): WorkerOptions => ({`  
  `group: {`  
    `concurrency: 5, // Maxim 5 job-uri paralele per magazin`  
  `},`  
  `// Global concurrency este setat la nivel de instanță worker`  
`});`

### **📄 /Neanelu\_Shopify/apps/web-admin/vite.config.ts**

`import { shopifyApp } from "@shopify/shopify-app-vite";`  
`import { reactRouter } from "@react-router/dev/vite";`  
`import { defineConfig } from "vite";`  
`import tsconfigPaths from "vite-tsconfig-paths";`

`export default defineConfig({`  
  `plugins: [`  
    `reactRouter(), // Suport pentru React Router v7`  
    `shopifyApp({`  
      `// Configurare automată a tunnel-ului și a componentelor`  
    `}),`  
    `tsconfigPaths(),`  
  `],`  
  `build: {`  
    `target: "esnext", // Necesar pentru Top-level await`  
  `},`  
`});`

### **📄 /Neanelu\_Shopify/apps/backend-worker/src/monitoring/otel-setup.ts**

`/**`  
 `* Configurare OpenTelemetry pentru Node.js v24.`  
 `* Instrumentare automată pentru:`  
 `* - Http / Express`  
 `* - PostgreSQL (pg)`  
 `* - Redis (ioredis)`  
 `* - BullMQ`  
 `*/`  
`import { NodeSDK } from '@opentelemetry/sdk-node';`  
`import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';`

`// Configurare export către Jaeger/Tempo`

## **Instrucțiuni pentru Debugging**

Datorită acestei structuri, dacă apare o eroare, poți izola rapid sursa:

1. **Eroare de Ingestie Date:** Mergi direct la apps/backend-worker/.../ingestion.  
2. **Eroare de Blocaj Cozi:** Verifică packages/queue-manager/.../fairness.  
3. **Eroare de UI/Routing:** Verifică apps/web-admin/app/routes.  
4. **Eroare de Query SQL/JSON:** Verifică packages/database/src/extensions.

Această structură respectă principiul "Single Responsibility" și este pregătită pentru scalare orizontală (poți rula mai multe pod-uri de backend-worker fără a modifica codul).
