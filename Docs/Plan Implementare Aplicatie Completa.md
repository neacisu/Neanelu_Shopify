# **Raport Tehnic Exhaustiv: Arhitectura și Implementarea Scalabilă a Aplicațiilor Shopify Multi-Tenant pentru Volume Masive de Date (1M+ SKU)**

---

## **Addendum (Dec 2025): Descoperiri validate în research (TypeScript)**

Acest raport este orientat pe arhitectura target-state. În research am validat practic (TypeScript, rulat cu `pnpm exec tsx`) câteva aspecte care trebuie tratate explicit în design pentru a evita presupuneri greșite.

### **1) Admin GraphQL auth: fallback fără Shopify CLI**

- În medii headless (Ubuntu), autentificarea prin Shopify CLI poate eșua. Pentru research am folosit un flow OAuth manual (captură `code` + exchange la `/admin/oauth/access_token`).
- Implicație: sistemul trebuie să aibă OAuth server-side complet (start/callback + state/HMAC) și stocare securizată a token-urilor (secret manager + criptare la rest).

### **2) Bulk Operations JSONL: structură și stitching**

- Exportul Bulk Ops produce JSONL masiv cu entități separate (`Product`, `ProductVariant`).
- Varianta referă produsul prin `__parentId`. Asta impune o etapă explicită de reconstrucție relațională (stitching) în pipeline-ul de ingestie.

### **3) „TOT / fetch everything” pe Product: generator bazat pe schema + paginare metafields**

- Pentru a citi „tot ce se poate” despre un produs, am validat o abordare bazată pe schema introspection: enumerare câmpuri pentru tipul `Product` și query generation stabil.
- Pentru `metafields`, este necesară paginare completă (`first: 250` + `after`) și raportarea explicită a numărului de intrări preluate.

### **4) Limitare: app-owned metafields**

- Metafield-urile cu namespace de tip `app--<id>--...` sunt accesibile doar aplicației owner. Cu token de staff/Admin pot apărea goale.
- Implicație: nu presupunem că „fetch all metafields” include și namespace-uri app-owned; dacă sunt critice, le citim în contextul aplicației owner sau le persistăm separat.

### **5) Determinism pentru reproducibilitate**

- Pentru debug și comparații între implementări (Python/TS), sampling-ul (vendor/produs) trebuie să fie determinist (fără random), altfel diferențele sunt greu de atribuit.

## **1\. Introducere și Context Strategic**

În peisajul actual al comerțului electronic, capacitatea de a procesa și analiza volume masive de date nu mai reprezintă un avantaj competitiv opțional, ci o necesitate fundamentală. Comercianții care operează la scară largă, gestionând cataloage de produse ce depășesc un milion de unități (SKU), se confruntă cu limitări tehnice severe impuse de infrastructurile tradiționale și de limitele API standard ale platformelor SaaS precum Shopify. Prezentul raport detaliază un plan de implementare riguros, structurat pe faze și sub-faze, pentru dezvoltarea unei aplicații Shopify capabile să gestioneze aceste volume imense, integrând funcționalități avansate de căutare semantică (Vector Search) și procesare asincronă multi-tenant.  
Provocarea centrală o constituie necesitatea de a sincroniza și actualiza milioane de entități (produse, variante, metafield-uri) respectând în același timp limitele stricte de rată ale API-ului Shopify (Leaky Bucket Algorithm) și asigurând echitatea resurselor într-un mediu partajat (multi-tenant). Analiza preliminară indică faptul că abordările sincrone tradiționale, bazate pe REST sau GraphQL standard, sunt matematic nefezabile pentru aceste volume; o simplă actualizare a unui catalog de 1 milion de produse, la o rată de 2 cereri pe secundă, ar necesita aproximativ 5,7 zile de procesare continuă.  
Soluția arhitecturală propusă în acest raport se bazează pe o schimbare de paradigmă, trecând de la procesarea secvențială la o arhitectură orientată pe evenimente (Event-Driven Architecture), utilizând intensiv API-ul Shopify Bulk Operations pentru ingestia datelor , cozi de mesaje distribuite cu prioritizare echitabilă (Fairness Queuing) prin BullMQ Pro și o stocare hibridă PostgreSQL-Redis pentru persistență și căutare vectorială rapidă.

### **1.x: Standard unificat de secrets management și promovare dev/staging/prod**

Pentru a evita scurgerile de credențiale și drift între medii, proiectul impune: (1) `.env.example` versionat cu lista completă de variabile obligatorii (SHOPIFY_API_KEY/SECRET/SCOPES, POSTGRES_URL, REDIS_URL, BULLMQ_PRO_TOKEN, NPM_TASKFORCESH_TOKEN, OPENAI_API_KEY, ENCRYPTION_KEY_256, OTEL_EXPORTER_OTLP_ENDPOINT, APP_HOST), (2) `.env` în .gitignore, folosit doar local, fără valori reale în repo, (3) secret manager (OpenBAO, self-hosted în Docker) ca sursă unică de adevăr pentru staging/prod, injectat în runtime prin OpenBAO Agent (template → env-file montat read-only), (4) rotație trimestrială pentru token-urile externe (Shopify, BullMQ Pro, OpenAI) și cheile AES, cu audit al accesului. `.npmrc` nu conține token-uri hardcodate; folosește `${NPM_TASKFORCESH_TOKEN}` din mediul curent.

## **2\. Faza 1: Fundamentarea Arhitecturală și Infrastructura Hibridă**

> **Notă corespondență faze:** Acest document folosește numerotare Faza 1-6. Maparea către `Plan_de_implementare.md` (F0-F7): Faza 1 ≈ F1+F2, Faza 2 ≈ F3, Faza 3 ≈ F4, Faza 4 ≈ F5, Faza 5 ≈ F6, Faza 6 ≈ F7.

Prima fază a proiectului este critică, deoarece deciziile luate aici vor dicta limitele superioare de scalabilitate ale sistemului. Obiectivul principal este stabilirea unei fundații care să suporte nu doar volumul static de date (storage), ci și fluxul dinamic intens (throughput) generat de operațiunile bulk și de interogările vectoriale.

### **Sub-faza 1.1: Proiectarea Stratului de Persistență Poliglotă**

Pentru a gestiona complexitatea datelor e-commerce combinate cu cerințele de inteligență artificială, o singură bază de date este insuficientă. Arhitectura propusă adoptă o strategie de persistență poliglotă, separând responsabilitățile între stocarea relațională robustă și stocarea volatilă de înaltă performanță.

#### **1.1.1 Stocarea Relațională: PostgreSQL 18.1 și Optimizarea JSONB**

**PostgreSQL 18.1** este selectat ca sursă de adevăr pentru datele structurate (utilizatori, configurări ale magazinelor, log-uri de audit). Versiunea 18.1 aduce optimizări critice pentru JSONB (compresie avansată, I/O asincron) și overhead RLS neglijabil (<1-2%). Deși datele produselor Shopify sunt inerent flexibile (schemă variabilă prin metafield-uri), utilizarea PostgreSQL oferă avantaje majore prin suportul nativ pentru tipul de date JSONB și capacitatea de indexare avansată a acestuia.  
Un aspect crucial în această sub-fază este proiectarea schemei pentru a suporta ingestia rapidă. Operațiunile standard INSERT sunt prea lente pentru milioane de rânduri. Arhitectura va utiliza fluxuri de date (Streams) conectate direct la comanda COPY FROM STDIN a PostgreSQL, permițând inserarea a zeci de mii de înregistrări pe secundă direct din fișierele JSONL procesate. Această abordare elimină overhead-ul tranzacțional per rând și reduce presiunea asupra colectorului de gunoi (Garbage Collector) din Node.js.

|Caracteristică PostgreSQL|Implementare Specifică|Justificare Tehnică|
|:----|:----|:----|
|**Partitionare**|Partitionare declarativă după shop_id|Izolarea datelor per tenant și optimizarea interogărilor mari.|
|**JSONB Indexing**|Index GIN pe coloana metafields|Permite filtrarea rapidă a produselor bazată pe atribute arbitrare fără alterarea schemei.|
|**Bulk Ingestion**|pg-copy-streams|Ingestie masivă prin COPY FROM STDIN pentru throughput ridicat.|

#### **1.1.2 Stocarea Vectorială și Caching Semantic: Redis 8.4**

Deși PostgreSQL oferă extensia pgvector, arhitectura recomandă utilizarea **Redis 8.4** (cu modulele RediSearch și RedisJSON) pentru stratul de căutare vectorială și caching semantic. Motivul este latența: în scenariile de e-commerce, căutarea trebuie să returneze rezultate în sub 100ms. Redis, operând integral în memorie, oferă performanțe superioare pentru algoritmii de tip HNSW (Hierarchical Navigable Small World) comparativ cu stocarea pe disc.  
Redis va servi o triplă funcție:

1. **Backend pentru Cozi (BullMQ):** Gestionarea stării job-urilor asincrone.  
2. **Semantic Cache (CESC):** Stocarea perechilor întrebare-răspuns pentru LLM, reducând costurile API cu până la 90%.  
3. **Vector Database:** Indexarea embedding-urilor produselor pentru funcționalitatea de "Related Products" și căutare semantică.

#### **1.1.3 Disciplina RLS și conexiuni PostgreSQL**

Pentru a evita scurgerile de context între tenant-uri în conexiuni reutilizate din pool, fiecare request și fiecare worker BullMQ trebuie să ruleze în tranzacție și să seteze explicit `SET LOCAL app.current_shop_id = $shopId` la checkout-ul fiecărei conexiuni. Comanda se reaplică la fiecare împrumut din pool, nu doar la prima inițializare. În plus, se adaugă un test de integrare cu doi magneți consecutivi pe același worker (shop A → shop B) care verifică că RLS nu returnează datele primului tenant după schimbarea `shop_id`.

### **Sub-faza 1.2: Strategia de Autentificare și Gestionarea Token-urilor Offline**

Operarea în fundal (background jobs) necesită acces continuu la API-ul Shopify, independent de prezența utilizatorului la consolă. Utilizarea token-urilor de acces online (cu valabilitate de 24h) este riscantă pentru operațiuni bulk care pot dura zile.  
Sistemul va implementa exclusiv fluxul de autentificare **Offline Access Token**. Recent, Shopify a introdus posibilitatea ca aceste token-uri să expire, necesitând o logică de refresh. Implementarea trebuie să includă un serviciu de rotație a token-urilor care monitorizează antetele de răspuns API și execută proactiv refresh-ul token-ului folosind client\_credentials sau fluxul de re-autorizare silențioasă înainte de expirare. Securitatea acestor token-uri este critică; ele vor fi stocate criptat în baza de date (AES-256), iar cheile de decriptare vor fi gestionate printr-un serviciu de management al secretelor (OpenBAO, self-hosted).

### **Sub-faza 1.3: Skeleton CI/CD devreme (Week 1)**

CI/CD nu se amână în Faza 7. În prima săptămână se livrează un workflow GitHub Actions pe PR cu cache pnpm, pnpm install, lint, typecheck, test (backend `node --test`, frontend Vitest) și servicii efemere Postgres/Redis pentru integrare. Se adaugă un job de smoke `docker build` (multi-stage) pentru a prinde devreme probleme de packaging/ESM în monorepo și un pas trivy fs pentru CVE critice. Publicarea imaginii, semnarea SBOM și scanarea completă a imaginii rămân în hardening-ul din Faza 7.

## **3\. Faza 2: Ingestia Masivă a Datelor și Pipeline-ul Bulk Operations**

Aceasta este faza centrală a dezvoltării, adresând direct limitările de volum. Obiectivul este sincronizarea unui catalog de 1 milion de produse. Strategia se bazează pe API-ul GraphQL Admin Bulk Operations, singura metodă viabilă pentru a extrage și introduce cantități mari de date fără a bloca resursele API.

### **Sub-faza 2.1: Arhitectura de Fetching (Bulk Query)**

Interogarea datelor nu se poate face printr-un simplu request. Trebuie construită o mutație bulkOperationRunQuery care să solicite toate câmpurile necesare (titlu, descriere, variante, metafield-uri).

#### **2.1.1 Construcția Interogării și Limitări**

O limitare critică identificată în documentație este restricția privind numărul de conexiuni și complexitatea interogării. Deși API-ul GraphQL permite teoretic interogări complexe, operațiunile Bulk au restricții specifice pentru a preveni timeout-urile. Dacă interogarea depășește complexitatea admisă, operațiunea va eșua cu eroarea TIMEOUT.  
Soluția este segmentarea interogărilor. În loc de o singură interogare masivă care aduce produse, variante, imagini și metafield-uri simultan, sistemul va lansa operațiuni secvențiale (în limita **1 operațiune activă per magazin** conform **API 2025-10**; versiunea 2026-01 va crește limita la 5 concurente):

1. **Op 1:** Produse de bază \+ Variante (pentru structura de preț și SKU).  
2. **Op 2:** Produse \+ Metafields (pentru atribute descriptive).  
3. **Op 3:** Produse \+ Imagini (doar URL-uri pentru procesare ulterioară).

#### **2.1.2 Procesarea Fluxului JSONL (Streaming)**

Rezultatul unei operațiuni Bulk este un fișier JSONL (JSON Lines) disponibil la un URL semnat. Pentru 1 milion de produse, acest fișier poate atinge dimensiuni de ordinul gigabytes-ilor. Încărcarea acestuia în memoria RAM a unui proces Node.js va duce inevitabil la erori heap out of memory.  
Implementarea va utiliza **Node.js Readable Streams** combinate cu librării precum stream-json sau transformări native. Pipeline-ul de procesare va arăta astfel:

1. **Download Stream:** Flux HTTP de la URL-ul Shopify.  
2. **Unzip Stream:** Dezarhivare on-the-fly (dacă fișierul este comprimat).  
3. **Transform Stream:** Parsarea linie cu linie a JSON-ului. Deoarece JSONL-ul Shopify poate returna obiecte "copil" (ex: variante) pe linii separate față de "părinte" (produs), parserul nu poate asuma ordinea.  
4. **Database Write Stream:** Direcționarea obiectelor direct către PostgreSQL folosind pg-copy-streams. Reconstrucția relațiilor părinte-copil se va face ulterior în baza de date prin interogări SQL, care sunt mult mai eficiente decât manipularea obiectelor în memoria aplicației.

### **Sub-faza 2.2: Actualizarea Datelor (Bulk Mutation)**

Pentru scrierea datelor (ex: actualizarea embedding-urilor sau a prețurilor), folosim bulkOperationRunMutation. Aici intervin cele mai stricte limitări tehnice identificate în cercetare.

#### **2.2.1 Gestionarea Limitei de Fișier (Chunking Strategy)**

Documentația recentă (2025-2026) indică o creștere a limitei fișierului de upload de la 20MB la **100MB**. Totuși, pentru un catalog de 1M produse, volumul total de date JSONL va depăși cu mult 100MB.  
Sistemul trebuie să implementeze un algoritm de "Chunking" inteligent:

1. Estimarea dimensiunii fiecărei linii JSONL (bazată pe numărul de caractere).  
2. Gruparea liniilor în fișiere virtuale de maxim 90MB (pentru siguranță).  
3. Orchestrarea secvențială: Deoarece există o limită de 25.000 de operațiuni bulk pe zi , chunking-ul excesiv (fișiere prea mici) este la fel de periculos ca fișierele prea mari.

#### **2.2.2 Fluxul Staged Uploads**

Înainte de a rula mutația, fișierul trebuie încărcat în infrastructura Shopify. Aceasta este o procedură în doi pași care necesită implementare precisă:

1. **Rezervarea URL-ului:** Apelarea stagedUploadsCreate cu parametrul resource: BULK\_MUTATION\_VARIABLES și tipul MIME text/jsonl. Este crucial să se rețină că parametrii returnați (semnătura, politica) trebuie incluși exact în cererea POST ulterioară.  
2. **Upload-ul Efectiv:** Trimiterea fluxului de date către URL-ul semnat furnizat de Shopify (destinație temporară pentru procesare).  
3. **Execuția Mutației:** Apelarea bulkOperationRunMutation folosind stagedUploadPath obținut anterior.

## **4\. Faza 3: Modelarea Datelor și Metafields Avansate**

Shopify stochează datele adiționale în Metafields. Pentru o aplicație de căutare și filtrare, structura acestora este vitală. O problemă majoră identificată este limitarea numărului de metafield-uri și modul în care acestea sunt indexate.

### **Sub-faza 3.1: Definiții Programatice și Strategii de Namespace**

Pentru ca un metafield să fie utilizabil în filtrele magazinului (Storefront Filtering), acesta trebuie să aibă o definiție standard sau personalizată validată. Crearea manuală a definițiilor pentru mii de atribute este imposibilă.  
Aplicația va utiliza mutația metafieldDefinitionCreate pentru a genera definiții la cerere. Un parametru critic aici este useAsCollectionCondition: true, care permite utilizarea metafield-ului în colecții inteligente (Smart Collections). Fără acest flag, metafield-ul este doar stocare pasivă de date, inutilă pentru filtrarea dinamică.

#### **3.1.1 Strategia Multi-Namespace**

Dat fiind că interogările GraphQL standard pot fi limitate la un singur namespace per request în anumite contexte , aplicația va adopta o strategie de namespace unificat (ex: app\_search:attribute) sau va utiliza Bulk Operations pentru a extrage toate namespace-urile relevante într-o singură trecere, ocolind limitările interogărilor punctuale.

### **Sub-faza 3.2: Gestionarea Limitării de Variante**

Un produs poate avea maximum 100 de variante (sau 2000 cu API-uri noi în beta, dar limitat). Pentru produse complexe cu mii de combinații, aplicația va implementa o soluție de "Virtual Variants" folosind Metaobjects. Datele variantelor vor fi stocate în Metaobjects , iar produsul principal va referenția aceste obiecte. Aceasta permite depășirea limitei fizice de variante a Shopify, mutând logica de selecție în frontend-ul aplicației.

## **5\. Faza 4: Motorul Semantic și Integrarea AI (LLM)**

Această fază transformă datele brute într-un motor de căutare inteligent. Provocarea majoră este costul și latența generării de vectori (embeddings) pentru un volum mare de date.

### **Sub-faza 4.1: Pipeline-ul de Embeddings Cost-Eficient**

Utilizarea API-urilor sincrone (ex: OpenAI /v1/embeddings) pentru 1 milion de produse este prohibitivă financiar și tehnic.

#### **4.1.1 Utilizarea API-ului Batch**

Raportul recomandă trecerea la **OpenAI Batch API**, care oferă o reducere de 50% a costurilor față de API-ul standard, cu un SLA de livrare în 24 de ore.

- **Flux de lucru:** Produsele noi sau modificate sunt acumulate într-un buffer. O dată la 12-24 ore, un job BullMQ generează un fișier JSONL pentru Batch API, îl încarcă și așteaptă rezultatele.  
- **Calcul Cost:** Pentru 1M produse x 300 tokeni (titlu \+ descriere) \= 300M tokeni. La un preț standard de $0.13/1M tokeni (model text-embedding-3-small Batch), costul este neglijabil (\~$40), comparativ cu modelele mai vechi sau request-urile sincrone.

### **Sub-faza 4.2: Implementarea Context-Enabled Semantic Caching (CESC)**

Pentru a reduce latența căutărilor recurente și a evita apelurile inutile către LLM pentru generarea răspunsurilor sau a vectorilor de interogare, sistemul va implementa CESC folosind Redis.  
**Mecanismul CESC:**

1. **Interogare Utilizator:** "pantofi sport roșii".  
2. **Semantic Check:** Sistemul calculează embedding-ul interogării și caută în Redis un vector similar (threshold de similaritate \> 0.95).  
3. **Cache Hit:** Dacă se găsește o interogare similară anterioară (ex: "adidași roșii alergare"), se returnează rezultatul stocat instantaneu (latență \< 10ms).  
4. **Cache Miss:** Dacă nu, se execută căutarea completă în baza vectorială și se stochează rezultatul și vectorul interogării în cache.

Această tehnică este esențială pentru a menține performanța în perioadele de trafic intens (Black Friday), unde multe interogări sunt repetitive.

## **6\. Faza 5: Guvernanța Multi-Tenant și Echitatea Procesării (Fairness)**

Într-o aplicație SaaS partajată de sute de comercianți, problema "Vecinului Zgomotos" (Noisy Neighbor) este critică. Dacă un comerciant mare importă 1 milion de produse, nu trebuie să blocheze procesarea comenzilor pentru un comerciant mic.

### **Sub-faza 5.1: Implementarea Cozilor Echitabile (Fair Queuing)**

Soluția tehnică obligatorie este utilizarea **BullMQ Pro** cu funcționalitatea de **Groups**.

- **Grupare pe Shop ID:** Fiecare job adăugat în coadă va avea proprietatea group: { id: shopId }.  
- **Concurență Locală vs. Globală:**  
  - **Global Concurrency:** Numărul total de workeri disponibili în infrastructură (ex: 50 de procese Node.js).  
  - **Group Concurrency:** Limita de job-uri paralele per magazin (ex: maxim 5). Aceasta garantează că niciun magazin nu poate ocupa mai mult de 10% din capacitatea totală de procesare, indiferent câte milioane de job-uri adaugă în coadă.

### **Sub-faza 5.2: Rate Limiting Distribuit**

API-ul Shopify impune limite stricte. Aplicația trebuie să respecte aceste limite per magazin.

- **Mecanism:** Utilizarea Redis pentru a stoca starea "găleții" (token bucket) pentru fiecare magazin.  
- **Integrare BullMQ:** Workerii vor verifica disponibilitatea creditelor API înainte de a executa un job. Dacă limita este atinsă, job-ul este amânat (delayed) folosind funcția rateLimitGroup din BullMQ Pro, care pune pauză doar grupului respectiv, lăsând celelalte magazine să proceseze nestingherite.

## **7\. Faza 6: Optimizare, Testare și Lansare**

Dezvoltarea unei aplicații de această anvergură nu poate fi validată manual.

### **Sub-faza 6.1: Generarea Datelor Sintetice**

Testarea limitelor de 100MB sau a comportamentului la 1M produse necesită date de test. Utilizarea unui magazin de dezvoltare Shopify gol este insuficientă.

- **Strategie:** Utilizarea unor scripturi bazate pe faker.js sau shopify-test-data-generator pentru a genera fișiere JSONL masive care simulează structura reală a datelor (inclusiv erori intenționate, caractere speciale, HTML spart) pentru a testa robustețea parserului.

### **Sub-faza 6.2: Testarea la Încărcare (Load Testing)**

Simularea traficului de webhook-uri este vitală. Când o operațiune Bulk se termină, aplicația poate primi mii de webhook-uri simultan.

- **Tools:** Utilizarea unor utilitare precum PostCatcher sau scripturi k6 pentru a bombarda endpoint-urile aplicației cu webhook-uri simulate bulk\_operations/finish.  
- **Validare:** Sistemul trebuie să răspundă cu 200 OK în sub 1 secundă (doar punând job-ul în coadă) și să proceseze asincron datele, fără a bloca serverul web.

## **Concluzie**

Implementarea acestei aplicații necesită o disciplină arhitecturală strictă. Cheia succesului nu rezidă doar în codul scris, ci în orchestrarea fluxurilor de date. Prin utilizarea **Bulk Operations** cu strategie de chunking de 90MB, adoptarea **BullMQ Pro Groups** pentru echitate între tenanți și integrarea **Redis 8.4** pentru inteligență semantică și caching, aplicația poate scala la niveluri Enterprise, gestionând milioane de produse eficient și cost-efectiv. Ignorarea oricăreia dintre aceste componente (ex: omiterea rate limiting-ului per grup sau procesarea sincronă a datelor) va duce inevitabil la instabilitate și costuri operaționale nesustenabile.

### **Tabel Centralizator Tehnologii vs. Cerințe**

| Cerință | Tehnologie/Strategie Selectată | Motiv Principal (Research Insights) |
| :---- | :---- | :---- |
| **Ingestie 1M+ Produse** | GraphQL Bulk Operations \+ Node.js Streams | Evită limitele de rată API și consumul excesiv de memorie RAM. |
| **Multi-Tenancy Echitabil** | BullMQ Pro Groups | Previne blocarea resurselor de către un singur comerciant ("Noisy Neighbor"). |
| **Căutare Semantică Rapidă** | Redis 8.4 (RediSearch) | Performanță sub-ms pentru vector search față de disk-based DBs. |
| **Costuri AI Reduse** | OpenAI Batch API \+ Semantic Caching (Redis) | Reducere costuri cu 50-90% prin batching și caching contextual. |
| **Filtrare Dinamică** | Metafield Definitions Programatice | Permite filtrarea nativă în Shopify Storefront 2.0. |
| **Stabilitate Job-uri** | Offline Access Tokens cu Refresh | Asigură continuitatea proceselor lungi (\>24h). |

#### **Works cited**

1. Shopify API limits, <https://shopify.dev/docs/api/usage/limits>
2. Perform bulk operations with the GraphQL Admin API - Shopify Dev Docs, <https://shopify.dev/docs/api/usage/bulk-operations/queries>
3. BullMQ - Background Jobs processing and message queue for NodeJS | BullMQ, <https://bullmq.io/>
4. Groups | BullMQ, <https://docs.bullmq.io/bullmq-pro/groups>
5. Building a Context-Enabled Semantic Cache with Redis, <https://redis.io/blog/building-a-context-enabled-semantic-cache-with-redis/>
6. Build an E-commerce Chatbot With Redis, LangChain, and OpenAI, <https://redis.io/blog/build-ecommerce-chatbot-with-redis/>
7. NPM's pg-copy-streams - SOOS, <https://app.soos.io/research/packages/NPM/-/pg-copy-streams/>
8. brianc/node-pg-copy-streams: COPY FROM / COPY TO for node-postgres. Stream from one database to another, and stuff. - GitHub, <https://github.com/brianc/node-pg-copy-streams>
9. Semantic caching for faster, smarter LLM apps - Redis, <https://redis.io/blog/what-is-semantic-caching/>
10. Prompt Caching is a Must! How I Went From Spending $720 to $72 Monthly on API Costs | by Du'An Lightfoot | Medium, <https://medium.com/@labeveryday/prompt-caching-is-a-must-how-i-went-from-spending-720-to-72-monthly-on-api-costs-3086f3635d63>
11. Offline access tokens now support expiry and refresh - Shopify developer changelog, <https://shopify.dev/changelog/offline-access-tokens-now-support-expiry-and-refresh>
12. About offline access tokens - Shopify Dev Docs, <https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens>
13. bulkOperationRunQuery - GraphQL Admin - Shopify.dev, <https://shopify.dev/docs/api/admin-graphql/latest/mutations/bulkoperationrunquery>
14. Loading large amounts of data performantly using Node.js Streams - Corey Cleary, <https://www.coreycleary.me/loading-tons-of-data-performantly-using-node-js-streams>
15. How can I manage JSONL parsing for large data with bulk operations? - Shopify Community, <https://community.shopify.com/c/shopify-discussions/jsonl-parsing-issue-for-bulk-operations/m-p/2104238>
16. Bulk import data with the GraphQL Admin API - Shopify Dev Docs, <https://shopify.dev/docs/api/usage/bulk-operations/imports>
17. Faster bulk operations - Shopify developer changelog, <https://shopify.dev/changelog/faster-bulk-operations>
18. Upload multiple JSONL files (stagedUploadsCreate) - GraphQL Admin API Troubleshooting, <https://community.shopify.dev/t/upload-multiple-jsonl-files-stageduploadscreate/10840>
19. metafieldDefinitionCreate - GraphQL Admin - Shopify Dev Docs, <https://shopify.dev/docs/api/admin-graphql/latest/mutations/metafieldDefinitionCreate>
20. MetafieldDefinition - GraphQL Admin - Shopify Dev Docs, <https://shopify.dev/docs/api/admin-graphql/latest/objects/MetafieldDefinition>
21. Smart collections with metafields - Shopify Help Center, <https://help.shopify.com/en/manual/custom-data/metafields/smart-collections>
22. Is it possible to query more than one namespace - Shopify Community, <https://community.shopify.com/t/is-it-possible-to-query-more-than-one-namespace/7954>
23. Efficiently Using Shopify GraphQL to Retrieve Product Metafields, <https://www.accentuate.io/blogs/wiki/efficiently-using-shopify-graphql-to-retrieve-product-metafields>
24. Metaobject limits - Shopify Dev Docs, <https://shopify.dev/docs/apps/build/metaobjects/metaobject-limits>
25. Metaobjects - Shopify Help Center, <https://help.shopify.com/en/manual/custom-data/metaobjects>
26. Batch API FAQ - OpenAI Help Center, <https://help.openai.com/en/articles/9197833-batch-api-faq>
27. Batch API | Gemini API - Google AI for Developers, <https://ai.google.dev/gemini-api/docs/batch-api>
28. How we built a fair multi-tenant queuing system - Inngest Blog, <https://www.inngest.com/blog/building-the-inngest-queue-pt-i-fairness-multi-tenancy>
29. Concurrency - BullMQ, <https://docs.bullmq.io/bullmq-pro/groups/concurrency>
30. Local group rate limit - BullMQ, <https://docs.bullmq.io/bullmq-pro/groups/local-group-rate-limit>
31. Automate generation of test/fake data (customers, orders, products etc.), which can be used for Shopify application testing. - GitHub, <https://github.com/saumets/shopify-test-data-generator>
32. Webhook Testing Made Easy - Shopify Engineering, <https://shopify.engineering/17488436-webhook-testing-made-easy>
33. Creating webhooks - Shopify Help Center, <https://help.shopify.com/en/manual/fulfillment/setup/notifications/webhooks>
