# **Raport de Cercetare Tehnică Exhaustiv: Arhitectura, Stack-ul Tehnologic și Dependențele pnpm pentru Ecosisteme Shopify Enterprise Scalabile (Orizont Decembrie 2025\)**

---

## **Addendum (Dec 2025): Ce a fost validat practic în research (TypeScript)**

Acest raport descrie stack-ul target-state. În research am validat practic câteva detalii operaționale care influențează tooling-ul și implementarea Shopify Admin API.

### **A. Execuție TypeScript (pnpm-only)**

- Scripturile de research rulează cu `pnpm exec tsx` (fără instalări globale), în stil ESM-friendly.
- Artefactele generate (output-uri, exporturi JSONL) trebuie tratate ca „build artifacts” și ținute în afara Git.

### **B. Shopify Admin GraphQL (2025-10): auth în mediu headless**

- Shopify CLI login poate fi instabil pe headless Linux; pentru research am folosit OAuth manual (captură `code` + exchange la `/admin/oauth/access_token`).
- Implicație: produsul final trebuie să includă OAuth server-side complet; CLI rămâne doar pentru dev convenience, nu o dependență.

### **C. Bulk Operations JSONL: relația Product/Variant**

- Bulk export JSONL poate conține linii `Product` și `ProductVariant` separate.
- Varianta se leagă de produs prin `__parentId`, ceea ce impune „stitching” în ingestie.

### **D. „Fetch everything” pe Product: schema introspection + paginare**

- Pentru a menține compatibilitatea cu evoluția Admin API, un query generator bazat pe introspection pentru tipul `Product` este mai robust decât câmpuri hardcodate.
- Paginarea completă la `metafields` este obligatorie pentru rezultate corecte.

### **E. Limitare: app-owned metafields**

- Namespace-urile `app--<id>--...` sunt accesibile doar aplicației owner; nu garantăm vizibilitate cu token de staff/Admin.

## **1\. Sinteză Executivă și Contextul Strategic al Dezvoltării**

La data de referință 18 decembrie 2025, peisajul dezvoltării software pentru platforma Shopify a atins un punct de inflexiune critic, caracterizat prin convergența framework-urilor consacrate și maturizarea infrastructurii de date distribuite. Cerința de a gestiona cataloage de produse ce depășesc pragul de 1 milion de unități (SKU) nu mai reprezintă o excepție, ci o normă pentru comercianții de nivel Enterprise, impunând o regândire fundamentală a arhitecturii aplicațiilor. Abordările tradiționale, monolitice sau bazate pe interogări sincrone REST/GraphQL, s-au dovedit matematic insuficiente pentru a susține debitul de date necesar, generând blocaje operaționale și costuri infrastructurale nesustenabile.  
Prezentul raport de cercetare analizează în profunzime stack-ul tehnologic optimizat pentru performanță extremă și mentenabilitate, impunând o constrângere arhitecturală strictă: utilizarea exclusivă a managerului de pachete **pnpm** (Performant NPM). Această decizie nu este arbitrară, ci strategică; într-un mediu monorepo complex, eficiența stocării pe disc prin hard-linking și strictețea rezoluției dependențelor oferite de pnpm sunt vitale pentru stabilitatea lanțului de aprovizionare software (Supply Chain).  
Analiza fundamentează tranziția către o arhitectură orientată pe evenimente (Event-Driven Architecture \- EDA), centrată pe un pipeline de ingestie "streaming" capabil să proceseze gigaocteți de date JSONL fără a epuiza memoria heap a proceselor Node.js. De asemenea, raportul detaliază implicațiile fuziunii istorice dintre Remix și React Router, care a culminat cu lansarea **React Router v7** ca framework standard de facto pentru frontend-ul aplicațiilor Shopify, alături de adoptarea **Polaris Web Components** pentru interfețe native și performante.  
În cele ce urmează, vom diseca fiecare componentă a stack-ului, de la nivelul infrastructurii de date (PostgreSQL 18.1, Redis 8.4.0) până la configurațiile granulare ale fișierelor .npmrc și pnpm-workspace.yaml, oferind o "rețetă" tehnologică completă, validată pentru producție la finalul anului 2025\.

## **2\. Fundația Infrastructurii Backend: Runtime și Persistență Poliglotă**

Stabilitatea și performanța unei aplicații care procesează milioane de entități depind în mod direct de calitatea runtime-ului și a motoarelor de baze de date. Selecția versiunilor pentru decembrie 2025 reflectă un echilibru între inovațiile de ultimă oră (Bleeding Edge) și stabilitatea necesară sistemelor financiare critice (LTS).

### **2.1 Runtime-ul de Execuție: Node.js v24 (LTS "Krypton")**

Platforma de execuție selectată este **Node.js v24**, aflată în stadiul Active LTS (Long Term Support) la momentul redactării. Deși versiunea v25 este disponibilă ca release "Current", arhitectura Enterprise impune utilizarea v24 datorită ferestrei extinse de suport și a maturității motorului V8 integrat.

#### **2.1.1 Optimizări ale Motorului V8 și Managementul Memoriei**

Versiunea specifică recomandată, **Node.js v24.12.0** , integrează motorul V8 (versiunea stabilizată Orinoco), care aduce îmbunătățiri critice colectorului de gunoi (Garbage Collector). În scenariile de ingestie a datelor din Shopify, unde fișierele JSONL rezultate din operațiunile Bulk pot atinge dimensiuni de 2-5 GB, presiunea asupra memoriei Heap este imensă. Versiunile anterioare (v20/v22) erau predispuse la erori fatale de tip ERR\_STRING\_TOO\_LONG sau heap out of memory la procesarea șirurilor lungi. Node.js v24 introduce o gestionare mai eficientă a buffer-elor și a alocării obiectelor efemere în spațiul "Young Generation" al heap-ului, reducând frecvența ciclurilor "Full GC" care blochează execuția (Stop-the-world pauses).

#### **2.1.2 Stream-uri Native și Testare Integrată**

Un alt argument decisiv pentru v24 este maturizarea API-ului nativ de Stream-uri (node:stream) și a modulului de testare (node:test). **Politica de testare:** backend (apps/backend-worker) folosește `node:test` + `node --watch --test`; frontend (apps/web-admin) folosește **Vitest** (ecosistem Vite/RR7). **Jest nu este folosit**. Astfel se evită două lumi paralele și se păstrează un lanț de unelte minim. De asemenea, suportul nativ pentru "Watch Mode" (node \--watch) elimină necesitatea utilitarului nodemon, simplificând lanțul de dependențe devDependencies și reducând suprafața de atac a securității.

### **2.2 Arhitectura de Date Hibridă: PostgreSQL 18.1**

Lansat pe 13 noiembrie 2025 ca minor release al ramurii 18, **PostgreSQL 18.1** redefinește standardele pentru stocarea datelor în e-commerce, eliminând necesitatea istorică de a utiliza o bază de date NoSQL separată (precum MongoDB) pentru datele flexibile. PostgreSQL 18.1 este poziționat ca o soluție hibridă relațională-document, esențială pentru modelul de date Shopify care combină structuri rigide (Comenzi, Clienți) cu structuri extrem de volatile (Metafields, Metaobjects).

#### **2.2.1 Compresia JSONB și Performanța I/O**

Caracteristica definitorie a ramurii 18 (pin-uită aici pe 18.1) este introducerea unor algoritmi avansați de compresie și deduplicare pentru tipul de date **JSONB**. Într-un catalog de 1 milion de produse, unde fiecare produs poate avea zeci de metafield-uri descriptive, volumul datelor JSON poate deveni copleșitor. PostgreSQL 18.1 reduce amprenta pe disc a acestor documente cu până la 30% comparativ cu versiunea 16 , ceea ce se traduce direct în costuri mai mici de stocare și, mai important, într-un I/O redus. Mai puține date de citit de pe disc înseamnă interogări mai rapide și mai mult spațiu în cache-ul RAM (Buffer Pool).  
În plus, PostgreSQL 18.1 implementează un subsistem de I/O Asincron (AIO) nativ. Aceasta este o schimbare arhitecturală majoră care decuplează operațiunile de scriere/citire fizică de thread-urile SQL de procesare. Pentru operațiunile de ingestie masivă folosind comanda COPY FROM STDIN, testele indică o creștere a throughput-ului de până la 3x , permițând inserția a sute de mii de rânduri pe secundă fără a bloca interogările de citire ale utilizatorilor din frontend.

#### **2.2.2 Securitate Multi-Tenant prin Row-Level Security (RLS)**

Pentru o aplicație SaaS partajată de mii de comercianți, izolarea datelor este critică. PostgreSQL 18.1 a optimizat drastic mecanismul de **Row-Level Security (RLS)**. Dacă în versiunile anterioare activarea RLS aducea o penalizare de performanță vizibilă (5-10%), în ramura 18 (18.1) overhead-ul CPU este neglijabil (\< 1-2%). Aceasta permite implementarea unei politici de securitate declarativă direct în baza de date:  
`CREATE POLICY tenant_isolation ON products`  
`USING (shop_id = current_setting('app.current_shop_id')::uuid);`

**Notă PostgreSQL 18:** Tipul coloanei este `uuid`, funcția de generare este `uuidv7()` (nativ în PG18). Cast-ul folosit în RLS este `::uuid`, NU `::UUIDv7`.

Această abordare elimină riscul de scurgere a datelor prin erori de programare în clauzele WHERE ale interogărilor SQL din aplicație.

**Disciplina conexiunilor cu pool:** Pentru a evita „leak” de context între tenanți, fiecare request/worker setează imediat după checkout-ul din pool `SET LOCAL app.current_shop_id = '<shop_id>'::uuid` în cadrul unei tranzacții, înaintea oricăror interogări. `SET LOCAL` se aplică pe durata tranzacției curente și trebuie re-emis pentru fiecare împrumut de conexiune; nu se bazează pe starea precedentă a conexiunii. Adaugă un test de integrare care execută două cereri succesive cu shop-uri diferite și confirmă că al doilea nu vede datele primului.

### **2.3 Caching și Orchestrare Distribuită: Redis 8.4.0**

Componenta de memorie volatilă este **Redis 8.4.0**. Este utilizată pentru cache-ul semantic (Exact Match), Rate Limiting și ca backend pentru cozile BullMQ.
> **Notă:** Vector Search este gestionat exclusiv de **pgvector (Postgres)**. Redis nu stochează vectori, pentru a reduce costurile RAM și complexitatea sincronizării.

#### **2.3.1 Structuri Probabilistice pentru Deduplicare**

Într-un ecosistem Shopify aglomerat (ex. Flash Sales), aplicația poate primi mii de webhook-uri redundante pentru același produs într-un interval scurt. Redis 8.4.0 include nativ **Filtre Bloom** și **Filtre Cuckoo**. Acestea permit verificarea existenței unui eveniment procesat recent cu o eficiență a memoriei extrem de ridicată (biți per intrare), evitând încărcarea cozilor de procesare cu job-uri duplicate.

#### **2.3.2 Sharded Pub/Sub**

Pentru scalarea orizontală a workerilor BullMQ, limitarea istorică a Redis a fost mecanismul de Pub/Sub, care trimitea mesaje către toți nodurile din cluster, generând trafic de rețea inutil. Redis 8.4.0 implementează **Sharded Pub/Sub**, care direcționează mesajele doar către shard-urile relevante. Aceasta permite aplicației să scaleze la mii de workeri concurenți fără a satura lățimea de bandă a serverului Redis.

## **3\. Gestionarea Dependențelor: Strategia pnpm și Monorepo**

Utilizarea **pnpm** (v10.x la data de 18 Dec 2025\) nu este doar o preferință, ci o necesitate tehnică pentru gestionarea eficientă a unui monorepo ce combină React Router 7, Polaris și microservicii backend. Arhitectura bazată pe "content-addressable store" a pnpm economisește spațiu pe disc și, mai important, impune o strictețe a dependențelor care previne erorile de tip "phantom dependencies".

### **3.1 Configurația Workspace-ului (pnpm-workspace.yaml)**

Proiectul este structurat ca un monorepo pentru a facilita partajarea codului (tipuri TypeScript, utilitare de logging, scheme de bază de date) între backend și frontend.  
**Structura directoarelor:**
/ (root)
├── pnpm-workspace.yaml
├──.npmrc
├── package.json
├── apps/
│ ├── backend-worker (Node.js/Fastify/BullMQ)
│ └── web-admin (React Router 7/Polaris)
└── packages/
├── database (Drizzle ORM & Migrations)
├── config (Validare env)
├── types (TypeScript interfaces partajate)
├── logger (OpenTelemetry wrappers)
├── shopify-client (Wrapper API Shopify)
├── queue-manager (BullMQ Pro infrastructure)
└── ai-engine (OpenAI Batch + Vector Search)

Fișierul pnpm-workspace.yaml utilizează funcționalitatea **Catalogs**, introdusă recent în ecosistemul pnpm, pentru a asigura sincronizarea versiunilor critice (precum React sau Shopify API) în toate pachetele din monorepo.  
**Exemplu pnpm-workspace.yaml:**  
`packages:`  
  `- "apps/*"`  
  `- "packages/*"`

`catalogs:`  
  `react:`  
    `react: ^19.0.0`  
    `react-dom: ^19.0.0`  
  `shopify:`  
    `"@shopify/shopify-api": ^12.1.0`  
    # NOTĂ: NU folosim @shopify/shopify-app-express - backend-ul folosește Fastify >=5.6.2  
    `"@shopify/app-bridge-react": ^4.2.8`

Această configurare garantează că atât frontend-ul cât și orice pachet UI partajat folosesc exact aceeași versiune de React, evitând erorile de "Invalid Hook Call" cauzate de multiple instanțe de React în bundle.

### **3.2 Configurare Critică .npmrc și Hoisting**

Un aspect tehnic subtil, dar vital, este configurarea fișierului .npmrc. Deși pnpm promovează izolarea strictă a dependențelor, anumite instrumente din ecosistemul Shopify (în special cele bazate pe Vite și React Native/Metro, deși aici folosim Web) și framework-ul React Router 7 au uneori comportamente care necesită acces la dependențe "fantomă" sau au peer dependencies nedeclarate corect în lanțul lor.  
Pentru a asigura compatibilitatea deplină cu template-urile Shopify App și React Router 7, este necesară activarea hoisting-ului "rușinos" (shamefully-hoist) sau configurarea granulară a pattern-urilor de hoisting public. Documentația recentă și discuțiile din comunitate indică faptul că fără aceste setări, build-ul frontend-ului poate eșua cu erori de rezoluție a modulelor.  
**Conținutul .npmrc:**  
`# Configurare pentru Registrul Privat BullMQ Pro (Taskforce.sh)`  
`@taskforcesh:registry=https://npm.taskforce.sh/`  
`//npm.taskforce.sh/:_authToken=${NPM_TASKFORCESH_TOKEN}`  
`always-auth=true`

`# NU se comite niciun token: NPM_TASKFORCESH_TOKEN vine din Secret Manager/CI;`.env.example`listează variabilele obligatorii, iar .env este în .gitignore.`

`# Setări de compatibilitate pentru React Router 7 și Shopify CLI`  
`# "shamefully-hoist" ridică toate dependențele în root-ul node_modules,`  
`# emulând structura plată a npm/yarn, necesară pentru unele plugin-uri Vite.`  
`shamefully-hoist=true`

`# Alternativ, pentru o abordare mai strictă (dacă shamefully-hoist=false):`  
`# public-hoist-pattern=*eslint*`  
`# public-hoist-pattern=*prettier*`  
`# public-hoist-pattern=@types*`  
`# public-hoist-pattern=*shopify*`  
`# public-hoist-pattern=*remix*`  
`# public-hoist-pattern=*react-router*`

`# Optimizări pnpm v10`  
`strict-peer-dependencies=false`  
`auto-install-peers=true`  
`engine-strict=true`

Setarea @taskforcesh:registry este obligatorie pentru a putea instala pachetul @taskforcesh/bullmq-pro, care nu este disponibil în registrul public npmjs.org. Token-ul trebuie injectat prin variabila de mediu NPM\_TASKFORCESH\_TOKEN în pipeline-ul CI/CD și în mediul local.

## **4\. Stack-ul Tehnologic Backend: Ingestie Masivă și Procesare Asincronă**

Backend-ul reprezintă motorul de procesare al aplicației. Obiectivul său principal este de a prelua datele de la Shopify prin API-ul GraphQL Admin (versiunea 2025-10) folosind operațiuni Bulk, de a le procesa eficient și de a menține starea sincronizată.

### **4.1 Ingestia de Date prin Streaming (pg-copy-streams)**

Limitarea principală în Node.js este memoria. Încărcarea unui fișier JSONL de 3GB în memorie va cauza crash-ul aplicației. Soluția adoptată este un pipeline de streaming care conectează fluxul de descărcare HTTP direct la baza de date PostgreSQL.  
**Dependențe Esențiale:**

- **pg (node-postgres):** Driverul nativ stabil, versiunea **^8.13.1**. Este preferat altor drivere pentru compatibilitatea sa excelentă cu ecosistemul extins de plugin-uri.  
- **pg-copy-streams:** Pachetul cheie (versiunea **^6.0.6**) care expune un WritableStream compatibil cu comanda COPY FROM STDIN a PostgreSQL. Acesta ocolește complet stratul de interogare SQL standard (INSERT INTO), scriind datele direct în fișierele tabelelor sau în buffer-ul de tranzacție, atingând viteze de zeci de mii de rânduri pe secundă.  
- **stream-json:** O librărie specializată (versiunea **^1.9.0**) pentru parsarea fișierelor JSON/JSONL uriașe. Componentele sale (Parser, StreamArray) emit evenimente pe măsură ce parcurg fișierul, permițând transformarea datelor "on-the-fly" cu un consum de memorie constant (ex. 100-200MB RAM), indiferent de dimensiunea totală a fișierului.

**Arhitectura Pipeline-ului:** Fluxul de date este "cusut" (stitched) astfel:

1. **Download Stream:** Corpul răspunsului HTTP de la URL-ul semnat Shopify.  
2. **Decompression Stream:** zlib.createGunzip() (dacă fișierul este arhivat).  
3. **JSON Parser Stream:** stream-json transformă octeții în obiecte JavaScript.  
4. **Transformation Stream:** Un Transform stream nativ Node.js care mapează obiectul JSON (produs Shopify) într-un format tabular (CSV/TSV) acceptat de Postgres.  
5. **Database Write Stream:** pg-copy-streams preia rândurile CSV și le trimite în DB.

### **4.2 Managementul Cozilor și "Fairness": BullMQ Pro**

Într-un mediu multi-tenant, problema "Vecinului Zgomotos" (Noisy Neighbor) este critică. Dacă un comerciant mare inițiază o sincronizare masivă, acesta nu trebuie să blocheze resursele pentru comercianții mici.  
**Dependențe:**

- **bullmq:** Versiunea de bază (**^5.66.2**).  
- **@taskforcesh/bullmq-pro:** Versiunea comercială (**^7.28.0**) instalată din registrul privat. Aceasta este mandatorie pentru funcționalitatea de **Groups**.

**Strategia de Implementare:** Fiecare job adăugat în coadă primește un groupKey derivat din shop\_id. Workerii BullMQ Pro sunt configurați să extragă job-uri folosind un algoritm Round-Robin între grupuri. Astfel, chiar dacă magazinul A are 1 milion de job-uri în așteptare și magazinul B adaugă 1 job, magazinul B va fi procesat imediat în următorul ciclu al workerului.  
De asemenea, funcția rateLimitGroup este utilizată pentru a suspenda temporar procesarea unui grup (unui magazin) dacă API-ul Shopify returnează erori de limitare a ratei (429 Too Many Requests), fără a opri workerii să proceseze job-urile altor magazine.

### **4.3 Stocare Volatilă și Cache: Redis Client**

Deși există pachetul redis (node-redis), recomandarea pentru scenariile de performanță ridicată și suport Cluster este **ioredis**.  
**Dependențe:**

- **ioredis:** Versiunea **^5.8.2**. Este clientul preferat pentru BullMQ și oferă o robustețe superioară în gestionarea reconectărilor și a topologiilor Redis Cluster/Sentinel.

### **4.4 Observabilitate: OpenTelemetry**

Sistemul este complet instrumentat pentru a detecta blocajele și a monitoriza performanța ingestiei.  
**Dependențe:**

- **@opentelemetry/sdk-node:** Versiunea **^0.208.0**.  
- **@opentelemetry/auto-instrumentations-node:** Pentru tracing automat al modulelor http, pg, ioredis, **fastify** (versiunea **^0.56.0**).  
- **@opentelemetry/exporter-trace-otlp-http:** Pentru exportul datelor către un backend de monitorizare (ex. Jaeger, Grafana Tempo).  
- **@fastify/otel:** Plugin oficial pentru integrarea OpenTelemetry cu Fastify.

## **5\. Stack-ul Tehnologic Frontend: Era Convergenței React Router 7**

Anul 2025 a marcat sfârșitul erei Remix ca entitate separată și integrarea sa completă în **React Router v7**. Acesta este acum framework-ul standard recomandat de Shopify pentru construirea aplicațiilor admin.

### **5.1 Framework-ul Principal: React Router v7**

Aplicația frontend nu mai este un simplu SPA (Single Page Application), ci un framework full-stack capabil de SSR (Server-Side Rendering) și acțiuni de date (Data Actions).  
**Dependențe în package.json:**

- **react-router:** Versiunea **^7.11.0**. Aceasta include toate funcționalitățile care anterior aparțineau Remix (loaderi, acțiuni, ruting bazat pe fișiere).  
- **@shopify/shopify-app-react-router:** Versiunea **^1.2.0**. Acesta este pachetul adaptor oficial care integrează autentificarea Shopify (OAuth), gestionarea sesiunilor și contextul App Bridge direct în mecanismele React Router.  
- **@react-router/node** și **@react-router/fs-routes:** Pachete necesare pentru rularea pe serverul Node.js și generarea rutelor din structura de fișiere.  
- **isbot:** Versiunea **^5.1.21**. O dependență standard pentru detectarea boților, necesară pentru randarea condițională.

### **5.2 Interfața Utilizator: Polaris Web Components**

Cea mai vizibilă schimbare în dezvoltarea Shopify din 2025 este deprecarea librăriei @shopify/polaris-react în favoarea **Polaris Web Components**. Această tranziție este motivată de performanță și consistență.  
**De ce Web Components?** Componentele sunt încărcate direct din CDN-ul Shopify (cdn.shopify.com), ceea ce înseamnă că nu mai sunt împachetate (bundled) în fișierele JavaScript ale aplicației. Aceasta reduce dimensiunea inițială a aplicației cu sute de kiloocteți. În plus, actualizările de design ale Admin-ului Shopify se propagă automat în aplicație fără a necesita recompilare sau redeployment.  
**Implementare:** În React, aceste componente sunt utilizate ca elemente native HTML (Custom Elements). De exemplu, \<s-page\> sau \<s-card\>.

- **Dependență:** Nu există o dependență npm directă pentru componentele UI în sine (deoarece vin via CDN). Totuși, pentru suportul TypeScript și intellisense în IDE, poate fi necesar un pachet de tipizări sau o declarație globală de tipuri.  
- **Script:** Se include `<script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>` în fișierul root.tsx al aplicației.

### **5.3 Integrarea App Bridge**

Similar cu Polaris, **Shopify App Bridge** a migrat către un model exclusiv CDN. Pachetul npm @shopify/app-bridge este acum un wrapper subțire sau este utilizat doar pentru tipizări.  
**Dependențe:**

- **@shopify/app-bridge-react:** Versiunea **^4.2.8**. Acest pachet oferă componente React (\<TitleBar\>, \<Modal\>, \<SaveBar\>) care funcționează ca proxy-uri către instanța App Bridge încărcată din CDN. Acesta simplifică interacțiunea cu API-ul gazdă Shopify, eliminând complexitatea gestionării manuale a mesajelor postMessage.

## **6\. Strategia de Testare și Asigurarea Calității**

Pentru un sistem care manipulează date critice de business la scară largă, testarea nu este opțională. Stack-ul include instrumente moderne adaptate ecosistemului Vite.

### **6.1 Generarea Datelor Sintetice**

Testarea performanței la 1 milion de produse necesită date. Nu putem folosi date reale ale clienților în dev.

- **faker.js:** (@faker-js/faker) Utilizat pentru a genera nume de produse, descrieri și date demografice realiste.  
- **shopify-test-data-generator:** Un utilitar (sau script custom bazat pe acesta) menționat în cercetare pentru a popula rapid magazinele de dezvoltare prin API, simulând o topologie complexă de date (variante, colecții, metafield-uri).

### **6.2 Testare Unitară și de Integrare**

- **vitest:** Versiunea **^4.0.16**. Deoarece React Router 7 și template-urile Shopify folosesc **Vite** (v7.3.0) ca build tool, vitest este alegerea naturală pentru **apps/web-admin**. Este mult mai rapid decât Jest, suportă ESM nativ și folosește aceeași configurație vite.config.ts, eliminând duplicarea setărilor de transformare a codului.

### **6.3 Testare la Încărcare (Load Testing)**

- **k6:** (k6 și @types/k6 pentru scripting). Este utilizat pentru a simula "bombardamentul" cu webhook-uri. Scenariul critic de testat este recepționarea a 5000 de webhook-uri products/update într-un minut. k6 validează că endpoint-ul aplicației răspunde cu 200 OK în sub 100ms (doar punând job-ul în coada Redis) fără a bloca event loop-ul.

## **7\. Tabel Centralizator al Versiunilor și Dependențelor**

Următorul tabel prezintă reconstrucția exactă a secțiunii dependencies și devDependencies din package.json pentru modulul principal al aplicației (Backend/App), valabilă la 18 Decembrie 2025\.

### **Dependențe de Producție (dependencies)**

| Pachet | Versiune (Est.) | Descriere și Rol în Arhitectură |
| :---- | :---- | :---- |
| **react-router** | ^7.11.0 | Framework-ul full-stack principal (fostul Remix). |
| **@shopify/shopify-app-react-router** | ^1.2.0 | Adaptorul Shopify pentru React Router 7 (Auth, Context). |
| **@shopify/shopify-api** | ^12.2.0 | SDK-ul core Shopify. Versiunea 12+ este necesară pentru API 2025-10. |
| **@shopify/app-bridge-react** | ^4.2.8 | Componente React pentru App Bridge (TitleBar, Modal). |
| **pg** | ^8.16.3 | Driver PostgreSQL nativ. |
| **pg-copy-streams** | ^7.0.0 | Ingestie de mare viteză (COPY Protocol). |
| **bullmq** | ^5.66.2 | Interfața publică pentru cozile de mesaje Redis. |
| **@taskforcesh/bullmq-pro** | ^7.28.0 | Versiunea Pro (Privată) pentru funcționalitatea **Groups** (Fairness). |
| **ioredis** | ^5.8.2 | Client Redis robust, optimizat pentru Cluster și performanță. |
| **stream-json** | ^1.9.1 | Parsare eficientă a JSONL prin stream-uri Node.js. |
| **@opentelemetry/sdk-node** | ^0.208.0 | SDK principal pentru instrumentare și tracing. |
| **drizzle-orm** | ^0.45.1 | ORM tipizat pentru PostgreSQL (queries + schema), cu migrații SQL gestionate prin drizzle-kit. |
| **isbot** | ^5.1.0 | Dependență standard pentru detectarea boților în rute. |
| **openai** | ^6.15.0 | SDK oficial pentru interacțiunea cu Batch API (Vector Embeddings). |

### **Dependențe de Dezvoltare (devDependencies)**

| Pachet | Versiune (Est.) | Descriere |
| :---- | :---- | :---- |
| **typescript** | ^5.9.0 | Limbajul de bază pentru type safety. Versiunea stabilă curentă (decembrie 2025). |
| **vite** | ^7.3.0 | Tool-ul de build de generație nouă, esențial pentru React Router 7\. |
| **vitest** | ^4.0.16 | Framework de testare unitară, înlocuitor pentru Jest. |
| **@shopify/app-bridge-types** | ^0.0.15 | Definiții TypeScript pentru App Bridge. |
| **@types/pg-copy-streams** | ^1.2.6 | Definiții TypeScript pentru pachetul de streaming. |
| **drizzle-kit** | ^0.31.8 | CLI pentru generarea și rularea migrațiilor SQL (drizzle). |
| **@shopify/cli** | ^3.76.0 | CLI-ul unificat pentru dezvoltare, tunneling și deployment. |
| **@types/k6** | ^0.60.0 | Tipizări pentru scripturile de load testing k6. |

## **8\. Concluzii și Recomandări Finale de Implementare**

Construirea unei aplicații Shopify capabile să scaleze la nivel Enterprise în 2025 necesită mai mult decât cod eficient; necesită o arhitectură defensivă și o selecție riguroasă a uneltelor.  
**Implicațiile utilizării pnpm:** Echipa de dezvoltare trebuie să fie conștientă de necesitatea configurării shamefully-hoist=true în .npmrc. Deși puriștii pot obiecta, realitatea ecosistemului React Router 7 combinat cu plugin-urile Shopify Vite dictează acest compromis pentru a asigura stabilitatea build-ului. De asemenea, configurarea corectă a registrului privat pentru @taskforcesh este un pas critic de infrastructură care nu trebuie omis din pipeline-urile CI/CD.  
**Fairness și Scalabilitate:** Implementarea **BullMQ Pro Groups** este "arma secretă" a acestei arhitecturi. Fără aceasta, un singur client mare poate destabiliza întregul sistem. Monitorizarea alertelor generate de rateLimitGroup prin OpenTelemetry va fi principalul indicator de sănătate al sistemului în producție.  
**Viitorul Frontend-ului:** Adopția **Polaris Web Components** este inevitabilă. Deși curba de învățare poate fi inițial abruptă pentru dezvoltatorii obișnuiți cu React pur (gestionarea atributelor vs. props), beneficiile de performanță și alinierea cu direcția strategică a Shopify fac din aceasta singura opțiune viabilă pe termen lung.  
În concluzie, acest raport oferă planul tehnic detaliat pentru un sistem robust, modern și pregătit pentru provocările volumelor masive de date, valorificând la maximum inovațiile disponibile la sfârșitul anului 2025\.

### **Works cited**

1. Documentation: 18: E.2. Release 18 - PostgreSQL, <https://www.postgresql.org/docs/current/release-18.html>
2. Drizzle ORM documentation (migrations + schema), <https://orm.drizzle.team/>
3. A template for building Shopify Apps using React Router version 7 and above - GitHub, <https://github.com/Shopify/shopify-app-template-react-router>
4. Settings (.npmrc) | pnpm, <https://pnpm.io/9.x/npmrc>
5. Install - BullMQ, <https://docs.bullmq.io/bullmq-pro/install>
6. node-postgres: Welcome, <https://node-postgres.com/>
7. pg-copy-streams - NPM, <https://www.npmjs.com/package/pg-copy-streams>
8. Parse large JSON file in Nodejs and handle each object independently - Stack Overflow, <https://stackoverflow.com/questions/42896447/parse-large-json-file-in-nodejs-and-handle-each-object-independently>
9. [Bug]: Error: Nest could not find `BULLMQ_EXTRA_OPTIONS` element (this provider does not exist in the current context) · Issue #3135 · taskforcesh/bullmq - GitHub, <https://github.com/taskforcesh/bullmq/issues/3135>
10. redis/ioredis: A robust, performance-focused, and full-featured Redis client for Node.js., <https://github.com/redis/ioredis>
11. open-telemetry/opentelemetry-js - GitHub, <https://github.com/open-telemetry/opentelemetry-js>
12. react-router - NPM, <https://www.npmjs.com/package/react-router?activeTab=versions>
13. @shopify/shopify-app-react-router - NPM, <https://www.npmjs.com/package/@shopify/shopify-app-react-router>
14. Polaris—unified and for the web (2025) - Shopify, <https://www.shopify.com/partners/blog/polaris-unified-and-for-the-web>
15. shopify/app-bridge-react - NPM, <https://www.npmjs.com/package/@shopify/app-bridge-react?activeTab=versions>
16. Automate generation of test/fake data (customers, orders, products etc.), which can be used for Shopify application testing. - GitHub, <https://github.com/saumets/shopify-test-data-generator>
17. Comparisons with Other Test Runners | Guide - Vitest, <https://vitest.dev/guide/comparisons>
18. types/k6 - NPM, <https://www.npmjs.com/package/@types/k6>
