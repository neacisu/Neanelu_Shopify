# **Arhitectura Sistemelor E-Commerce de Mare Volum: Blueprint Tehnologic 2025**

---

## **Addendum (Dec 2025): Descoperiri validate în research (TypeScript)**

Blueprint-ul de mai jos este target-state. În research am validat practic, în TypeScript (rulat cu `pnpm exec tsx`), câteva constrângeri care trebuie reflectate în modul în care proiectăm integrarea Shopify.

### **1) Auth: nu presupunem Shopify CLI**

- În medii headless (Ubuntu), Shopify CLI login poate eșua. Pentru research am folosit un flow OAuth manual (captură `code` + exchange la `/admin/oauth/access_token`).
- Implicație: în producție, OAuth server-side (start/callback + state/HMAC) este obligatoriu.

### **2) Bulk Operations JSONL: stitching prin `__parentId`**

- Bulk export JSONL conține entități separate; variantele se leagă de produse prin `__parentId`.
- Implicație: ingestia trebuie să fie streaming-first și să reconstruiască relațiile explicit.

### **3) Product „TOT”: schema introspection + paginare metafields**

- Pentru a „citi tot ce se poate” despre un produs, query generation bazat pe schema introspection este mai robust decât câmpuri hardcodate.
- `metafields` necesită paginare completă pentru rezultate corecte.

### **4) Limitare: app-owned metafields**

- Metafield-urile `app--<id>--...` sunt vizibile doar în contextul aplicației owner; cu token de staff/Admin pot apărea ca goale.

### **5) Determinism în sampling pentru debugging**

- Pentru reproducibilitate (și comparații între implementări), sampling-ul trebuie să fie determinist (fără random).

## **1\. Introducere: Paradigma Dezvoltării Software în Decembrie 2025**

La data de 18 decembrie 2025, peisajul dezvoltării de aplicații enterprise pentru ecosistemul Shopify a atins un punct de inflexiune critic. Trecerea de la arhitecturile monolitice tradiționale către sisteme distribuite, orientate pe evenimente și bazate pe microservicii compozabile, nu mai este doar o preferință arhitecturală, ci o necesitate operațională. Într-o eră în care comercianții Shopify Plus gestionează cataloage de milioane de SKU-uri și necesită sincronizări în timp real între multiple canale de vânzare, stack-ul tehnologic ales trebuie să ofere nu doar performanță brută, ci și reziliență, scalabilitate elastică și o consistență a datelor impecabilă.

Acest raport de cercetare tehnică oferă o analiză exhaustivă și un plan de implementare pentru o aplicație TypeScript de ultimă generație, construită pe baza celor mai recente versiuni stabile disponibile la finalul anului 2025: Node.js v24 (LTS), PostgreSQL 18.1, Redis 8.4.0 și Shopify Admin API versiunea 2025-10. Obiectivul central este de a proiecta un sistem capabil să ingereze, să proceseze și să sincronizeze volume masive de date (metaobiecte, produse, stocuri) respectând limitele stricte ale API-urilor, asigurând în același timp izolarea multi-tenant și o latență minimă pentru utilizatorul final.

Vom explora în detaliu implicațiile trecerii la PostgreSQL 18.1 pentru stocarea hibridă relațională-document, strategiile de "backpressure" și "fairness" în cozile de mesaje BullMQ Pro, și tehnicile de "stitching" necesare pentru a depăși limitările de adâncime ale operațiunilor în masă (Bulk Operations) din GraphQL.

## ---

**2\. Analiza Stack-ului Tehnologic: Selecția Versiunilor pentru 2025**

Alegerea componentelor de infrastructură pentru o lansare în decembrie 2025 necesită un echilibru fin între stabilitatea versiunilor Long Term Support (LTS) și avantajele de performanță ale noilor release-uri. Analiza detaliată a fiecărei componente relevă sinergiile care fac posibilă această arhitectură.

### **2.1 Node.js: Bătălia dintre LTS și Current (v24 vs v25)**

La mijlocul lunii decembrie 2025, ecosistemul Node.js este dominat de două versiuni majore active. Decizia arhitecturală de a utiliza **Node.js v24 (LTS "Krypton")** în detrimentul versiunii v25 este fundamentată pe ciclusul de viață al suportului și pe optimizările specifice ale motorului V8.

| Caracteristică | Node.js v24 (LTS "Krypton") | Node.js v25 (Current) | Implicație Arhitecturală |
| :---- | :---- | :---- | :---- |
| **Statut Release** | Active LTS (din Oct 2025\) | Current (lansat Oct 2025\) | v24 oferă stabilitatea necesară pentru sisteme financiare critice.1 |
| **Data Lansării** | 06 Mai 2025 | 15 Octombrie 2025 | v24 a beneficiat de 7 luni de "battle-testing" în producție.1 |
| **Suport Activ** | Până în Octombrie 2026 | Până în Aprilie 2026 | Fereastra de suport extinsă a v24 reduce costurile de mentenanță pe termen lung.1 |
| **Motor V8** | Versiune stabilizată (Orinoco) | Versiune experimentală | v24 include optimizări cruciale pentru Garbage Collection la heap-uri mari (\>4GB), esențial pentru procesarea fișierelor JSONL.2 |

Analiză de Profunzime:  
Versiunea v24.12.0, disponibilă la momentul redactării, introduce îmbunătățiri semnificative în API-ul de Stream-uri și în gestionarea buffer-elor. În contextul procesării fișierelor masive de la Shopify (Bulk Operations), care pot depăși frecvent 2-3 GB pentru cataloage mari, stabilitatea managementului memoriei în v24 previne erorile de tip heap out of memory care erau frecvente în versiunile anterioare (v20/v22) la sarcini similare. De asemenea, suportul nativ pentru Watch Mode și Test Runner a devenit complet stabil în v24, eliminând necesitatea unor dependențe dev-time precum nodemon sau jest pentru unit tests de bază, simplificând lanțul de CI/CD. **Politică de testare:** backend (apps/backend-worker) folosește `node:test` + `node --watch --test`; frontend (apps/web-admin) folosește Vitest (ecosistem Vite/RR7). Jest nu este folosit.

### **2.2 PostgreSQL 18.1: Revoluția Hibridă Relațională-Document**

Lansarea PostgreSQL 18.1 în noiembrie 2025 3 a redefinit modul în care arhitecții de sistem privesc stocarea datelor e-commerce. Tradițional, dezvoltatorii trebuiau să aleagă între rigiditatea SQL și flexibilitatea NoSQL (ex. MongoDB). PostgreSQL 18.1 elimină acest compromis prin optimizări masive ale tipului de date JSONB.

**Inovații Cheie în PostgreSQL 18.1:**

1. **Compresia Avansată a JSONB:** Versiunea 18.1 introduce algoritmi de compresie dedicați pentru documentele JSON stocate, reducând amprenta pe disc cu până la 30% față de versiunea 16\. Aceasta este vitală pentru stocarea Metaobiectelor și Metafield-urilor Shopify, care sunt structuri de date denormalizate și repetitive.
2. **Subsistem I/O Optimizat:** Noul subsistem de I/O oferă îmbunătățiri de performanță de până la 3x pentru operațiunile de citire din stocare, accelerând scanările de indecși GIN (Generalized Inverted Index) folosiți pentru interogarea atributelor JSON.4
3. **Row-Level Security (RLS) Performant:** Pentru aplicațiile multi-tenant (SaaS), PostgreSQL 18.1 a redus drastic overhead-ul CPU asociat cu verificarea politicilor RLS pentru fiecare rând. Acest lucru permite implementarea izolării datelor la nivel de bază de date, o cerință critică de securitate, fără penalizările de performanță istorice.5

### **2.3 Redis 8.4.0 și Ecosistemul BullMQ**

Redis 8.4.0 (cu module **RediSearch** și **RedisJSON** integrate nativ) este distribuția standard pentru proiect: susține cozi BullMQ, caching și rate limiting. **IMPORTANT (AUDIT 2025-12-26): Vector Search este gestionat exclusiv de pgvector (PostgreSQL), NU de Redis.** Redis rămâne pentru: cozi, cache, rate limiting, bloom filters. Imaginea recomandată pentru compose este `redis:8.4`.

**Sinergia Redis 8.4.0 - BullMQ:**

- **Structuri Probabilistice:** Filtrele Bloom și Cuckoo native în Redis 8.4.0 permit deduplicarea eficientă a milioanelor de evenimente webhook (ex. PRODUCTS_UPDATE) înainte ca acestea să intre în coada de procesare, economisind resurse de calcul valoroase.
- **Sharded Pub/Sub:** Îmbunătățește scalabilitatea comunicării între workerii BullMQ distribuiți în cluster, eliminând gâtuirile de rețea prezente în versiunile anterioare.
- **RediSearch/RedisJSON:** Modulele incluse în Redis 8.4 sunt folosite pentru indexarea JSON și operațiile de caching. **Vector Search se face cu pgvector în PostgreSQL** pentru a reduce costurile RAM și complexitatea sincronizării.

---

**3\. Arhitectura Datelor în PostgreSQL 18.1: Modelare Hibridă**

Fundamentul oricărei aplicații Shopify de succes este schema bazei de date. În 2025, modelul strict relațional (3NF) este insuficient pentru a captura natura dinamică a datelor Shopify (Metafields, Metaobjects). Soluția propusă este un model hibrid care utilizează coloane relaționale pentru entitățile stabile și JSONB pentru datele extensibile.

### **3.1 Design-ul Tabelar și Strategia JSONB**

Pentru a gestiona eficient un catalog de 1 milion de produse, trebuie să evităm modelul EAV (Entity-Attribute-Value), care generează tabele gigantice și greu de interogat. În schimb, vom utiliza capabilitățile JSONB ale PostgreSQL 18.1\.

**Structura Tabelului products:**

| Coloană | Tip Date | Descriere & Strategie Indexare |
| :---- | :---- | :---- |
| id | UUIDv7 | Cheie primară internă. |
| shop\_id | UUIDv7 | Foreign Key către tabelul shops. Esențial pentru RLS. |
| shopify\_id | BIGINT | ID-ul original din Shopify. Indexat UNIQUE per shop\_id. |
| title | TEXT | Titlul produsului. Indexat cu pg\_trgm pentru căutare full-text rapidă. |
| updated\_at | TIMESTAMPTZ | Timestamp pentru sincronizare incrementală. |
| metafields | JSONB | Stochează toate metafield-urile produsului ca un singur document JSON. |
| metaobjects | JSONB | Referințe denormalizate către metaobiecte legate. |

Strategia de Indexare JSONB în PostgreSQL 18.1:  
PostgreSQL 18.1 permite crearea unor indecși GIN extrem de performanți pe structuri JSON arbitrare.

SQL

CREATE INDEX idx\_products\_metafields ON products USING GIN (metafields);

Această strategie permite interogări complexe, cum ar fi "Găsește toate produsele care au materialul 'Bumbac' definit în metafield-uri", cu timpi de execuție de ordinul milisecundelor, chiar și pe seturi de date de milioane de rânduri:

SQL

SELECT \* FROM products
WHERE shop\_id \= '...'
AND metafields @\> '{"custom": {"material": "Bumbac"}}';

Performanța acestor interogări în PostgreSQL 18.1 este comparabilă cu cea a bazelor de date document-oriented dedicate, eliminând nevoia de a sincroniza datele într-un sistem secundar precum Elasticsearch pentru filtrări de bază.8

### **3.2 Izolarea Multi-Tenant prin Row Level Security (RLS)**

Într-o aplicație care servește mii de comercianți, securitatea datelor este non-negociabilă. O greșeală în clauza WHERE a unei interogări SQL poate expune datele unui comerciant către altul. RLS rezolvă această problemă la nivelul motorului bazei de date.

Mecanismul de Funcționare:  
Definim o politică de securitate care impune ca orice interogare să returneze doar rândurile care aparțin comerciantului curent.

1. **Activarea RLS:**  
   SQL  
   ALTER TABLE products ENABLE ROW LEVEL SECURITY;

2. **Definirea Politicii:**  
   SQL  
   CREATE POLICY tenant\_isolation\_policy ON products  
   USING (shop\_id \= current\_setting('app.current\_shop\_id')::uuid);

   **Notă PostgreSQL 18:** Tipul este `uuid`, funcția de generare este `uuidv7()`. Cast-ul e `::uuid`, NU `::UUIDv7`.

3. Implementarea în Aplicație (Node.js Middleware):  
   Înainte de a executa orice logică de business, middleware-ul aplicației setează variabila de sesiune pentru conexiunea curentă la bază de date.  
   TypeScript  
   // Pseudo-cod pentru middleware  
   const client \= await pool.connect();  
   try {  
     await client.query(\`SET app.current\_shop\_id \= '${req.user.shopId}'\`);  
     await next(); // Execută logica  
   } finally {  
     client.release();  
   }

Impactul asupra Performanței în PostgreSQL 18.1:  
Testele de performanță arată că penalizarea introdusă de RLS în versiunea 18 este neglijabilă (\< 1-2%) comparativ cu riscurile de securitate eliminate. Acest mecanism este superior abordării de a crea scheme separate (schema-per-tenant) care devine greu de administrat la scară largă (mii de migrări de schemă).5

---

**4\. Integrarea Shopify GraphQL Admin API 2025-10**

Interfațarea cu Shopify în decembrie 2025 necesită o înțelegere profundă a versiunii API 2025-10, a limitelor de rată și a deprecierilor recente.

### **4.1 Strategia de Versionare și Deprecieri Critice**

La 18 decembrie 2025, versiunea stabilă este **2025-10**. Versiunea 2025-01 va ieși din suport la 1 ianuarie 2026, deci orice dezvoltare nouă trebuie să vizeze exclusiv 2025-10 sau candidatul de lansare 2026-01.13

Modificare Critică: Accesul la Metafield-uri  
O schimbare majoră în API-ul 2025-10 este eliminarea câmpului visibleToStorefrontApi din definițiile metafield-urilor. În versiunile anterioare, acesta era un boolean simplu. Acum, controlul vizibilității se face printr-un obiect access mai granular, care definește permisiunile pentru Storefront API și Admin API separat.

- **Acțiune Necesară:** Aplicația trebuie să utilizeze mutația standardMetafieldDefinitionEnable pentru a activa definițiile standard, asigurând compatibilitatea cu taxonomia Shopify și filtrele native din "Search & Discovery".13 Încercarea de a folosi vechiul câmp va rezulta în erori de validare a schemei GraphQL.

### **4.2 Managementul Limitelor de Rată (Cost-Based Limiting)**

Shopify folosește un model de cost calculat, nu un simplu contor de cereri. Un bucket standard are 1.000 puncte de cost, cu o rată de reumplere de 50 puncte/secundă.17

Provocarea Datelor Complexe:  
O interogare GraphQL care solicită produse, variantele lor, imaginile și metafield-urile poate costa ușor peste 500-800 puncte. Două astfel de cereri consecutive epuizează bucket-ul, ducând la erori THROTTLED.  
Soluția:  
Pentru orice operațiune care implică mai mult de 50 de entități sau date imbricate adânc, Bulk Operations API este obligatoriu. Cererile sincrone ("în timp real") trebuie rezervate exclusiv pentru interacțiunile UI directe ale utilizatorului (ex. afișarea detaliilor unui singur produs).

---

**5\. Strategia de Procesare în Masă: Pipeline-ul "Stitched"**

Procesarea cataloagelor mari (100k \- 1M produse) este cea mai complexă componentă a sistemului. API-ul Bulk Operation este puternic, dar are limitări stricte care necesită o arhitectură ingenioasă.

### **5.1 Limitări Structurale ale Bulk API în 2025**

Chiar și în versiunea 2025-10, Bulk API impune restricții pe care documentația oficială le menționează, dar a căror ocolire necesită experiență practică:

1. **Limita de Conexiuni:** O interogare nu poate conține mai mult de **5 conexiuni** (relații de tip edges/node).  
2. **Limita de Adâncime:** Imbricarea nu poate depăși 2 nivele.18  
3. **Concurența:** Pe versiunea 2025-10, este permisă o singură operațiune bulk activă per magazin (deși 2026-01 promite 5, trebuie să proiectăm pentru limita curentă).20

Scenariul Problematic:  
Dorim să sincronizăm: Produs \-\> Variante \-\> InventoryItem \-\> InventoryLevels (3 nivele). Simultan, vrem Produs \-\> Metafields și Variante \-\> Metafields. Această structură violează atât limita de adâncime, cât și pe cea de conexiuni.

### **5.2 Soluția: Operațiuni Secvențiale de "Coasere" (Stitching)**

Vom implementa o strategie de sincronizare în trei faze, unde datele sunt "cusute" (agregate) la nivelul bazei de date PostgreSQL.

#### **Faza 1: Sincronizarea Scheletului (Core Data)**

Lansăm o operațiune Bulk care aduce structura de bază: Produse, Variante (doar preț/sku/id) și Imagini.

- **Interogare:** Products \-\> Variants, Products \-\> Images.  
- **Procesare:** Fișierul JSONL rezultat este ingerat rapid. Aceasta creează rândurile în DB, stabilind ID-urile shopify\_id.

#### **Faza 2: Sincronizarea Meta-Datelor (Metafields & Metaobjects)**

O a doua operațiune Bulk, lansată după finalizarea primei, solicită doar ID-urile părinților și datele meta.

- **Interogare:** Products (id) \-\> Metafields, Products (id) \-\> Variants (id) \-\> Metafields.  
- **Procesare:** Folosim ID-urile pentru a face UPDATE pe rândurile existente în PostgreSQL, populând coloana metafields (JSONB). Această separare reduce dimensiunea fișierelor individuale și riscul de timeout.

#### **Faza 3: Sincronizarea Stocurilor (Inventory)**

A treia operațiune se concentrează pe stocuri, care sunt cele mai volatile date.

- **Interogare:** InventoryLevels.  
- **Procesare:** Actualizăm coloanele de stoc în tabelul variants (prin join pe inventory\_item\_id).

### **5.3 Ingestia Streaming cu Node.js și pg-copy-streams**

Descărcarea unui fișier JSONL de 2GB în memoria Node.js va cauza garantat o eroare Heap Out Of Memory. Soluția este utilizarea Stream-urilor native.

**Arhitectura Pipeline-ului de Ingestie:**

TypeScript

import { pipeline } from 'node:stream/promises';  
import { from as copyFrom } from 'pg-copy-streams';  
import fs from 'node:fs';  
import { Transform } from 'node:stream';

// Fluxul de date:  
// Download HTTP Stream \-\> JSONL Parser Stream \-\> CSV Formatter Stream \-\> PostgreSQL COPY Stream

async function ingestBulkFile(filePath: string, dbClient: PoolClient, shopId: string) {  
  const fileStream \= fs.createReadStream(filePath);

  // Transform Stream care parsează linie cu linie și pregătește datele pentru COPY  
  const transformStream \= new Transform({  
    writableObjectMode: true,  
    readableObjectMode: true,  
    transform(chunk, encoding, callback) {  
        //... logica de parsing JSON și convertire la formatul COPY (tab-separated)  
        const row \= \`${UUIDv7}\\t${jsonData.id}\\t${JSON.stringify(jsonData)}\\n\`;  
        this.push(row);  
        callback();  
    }  
  });

  // Conectare directă la STDIN-ul PostgreSQL  
  const dbStream \= dbClient.query(copyFrom(\`COPY products (id, shopify\_id, raw\_data) FROM STDIN\`));

  try {  
    await pipeline(  
      fileStream,  
      //... (streams intermediare de decompresie/parsing)  
      transformStream,  
      dbStream  
    );  
  } catch (err) {  
    // Gestionare erori stream  
  }  
}

Avantajul Performanței:  
Utilizarea pg-copy-streams este ordine de mărime mai rapidă decât inserțiile clasice (INSERT INTO... VALUES). Putem ingera 1 milion de rânduri în câteva minute, cu o amprentă de memorie constantă (ex. 100-200MB RAM), indiferent de dimensiunea fișierului.21

### **5.4 Gestionarea Metaobiectelor (1 Milion de Intrări)**

Metaobiectele au devenit esențiale în 2025\. Limita de 1 milion de intrări per definiție impune utilizarea Bulk API, deoarece paginarea standard prin GraphQL (limitată la 50/250 rezultate) ar necesita zeci de mii de cereri HTTP, ceea ce ar fi impracticabil. Bulk API nu necesită cursori și livrează toate datele într-un singur flux continuu, fiind singura metodă viabilă pentru volume mari.18

---

**6\. Procesare Asincronă Avansată: BullMQ Pro și Redis 8**

Într-un mediu multi-tenant, o coadă FIFO simplă este dezastruoasă. Dacă un comerciant mare ("MegaShop") lansează o sincronizare a 500.000 de produse, generând 500.000 de job-uri, un comerciant mic ("TinyShop") care vrea să sincronizeze 1 produs va trebui să aștepte ore întregi.

### **6.1 Algoritmul de "Fairness" cu BullMQ Groups**

Vom utiliza funcționalitatea de **Grupuri** din BullMQ Pro (sau o implementare manuală echivalentă în versiunea standard) pentru a izola job-urile fiecărui magazin.

Implementare Conceptuală:  
Fiecare job adăugat în coadă primește un groupKey egal cu shop_id (UUIDv7). Workerii BullMQ sunt configurați să nu proceseze job-urile secvențial global, ci să utilizeze un algoritm Round-Robin între grupuri.

TypeScript

// Configurare Worker cu limitare per Grup  
const worker \= new Worker('sync-queue', processor, {  
  limiter: {  
    max: 1, // Maxim 1 job concurent per grup (magazin)  
    duration: 1000,  
    groupKey: 'shopId' // UUIDv7 - aliniat cu RLS (shop_id)  
  }  
});

// Adăugarea unui job în coadă  
await queue.add('bulk-sync', { shopId: 'uuid-shop-id' }, {  
  group: { id: 'uuid-shop-id' } // UUIDv7, nu domain  
});

**Rezultat:** Chiar dacă "MegaShop" are 10.000 de job-uri în coadă, când "TinyShop" adaugă un job, acesta va fi procesat aproape imediat, deoarece face parte dintr-un grup diferit care nu este congestionat. Aceasta asigură o calitate a serviciului (QoS) echitabilă pentru toți clienții.26

### **6.2 Rate Limiting vs. Concurență**

Este crucial să distingem între cele două concepte în contextul Shopify:

- **Concurența Globală:** Numărul total de workeri (pod-uri Kubernetes) care rulează în paralel. Aceasta poate fi scalată orizontal.  
- **Concurența Per Magazin:** Trebuie limitată strict. Pentru Bulk Operations, limita este 1\. Pentru mutații standard, limita este dictată de costul API.

Folosind Redis, implementăm un "semafor distribuit". Înainte ca un worker să execute un job pentru un magazin, interogăm cheia Redis shopify:cost:${shop_id}. Dacă costul disponibil este sub pragul de siguranță, job-ul este amânat (job.moveToDelayed) folosind Retry-After header-ul returnat de Shopify, optimizând astfel consumul de API.17

**Notă:** shop_domain rămâne doar atribut de logging/tracing, nu identity. Toate cheile Redis și groupId-urile folosesc shop_id (UUIDv7) pentru aliniere cu RLS.

### **6.3 Gestionarea Erorilor în bulkOperationRunMutation**

Mutațiile în masă (importurile) au un comportament specific de eroare. Dacă dintr-un fișier de 10.000 de linii, 5 eșuează, operațiunea este marcată ca COMPLETED dar returnează un partialDataUrl.  
Strategia de Retry:

1. Descărcăm fișierul de rezultate (care conține doar succesele sau erorile explicite).  
2. Comparăm cu fișierul original (diffing bazat pe linia din JSONL).  
3. Identificăm rândurile lipsă sau cu erori.  
4. Reîncercăm doar acele rânduri specifice, eventual corectând datele sau folosind mutații individuale pentru debugging detaliat.29

---

**7\. Extensibilitate și Viitorul Aplicației**

### **7.1 Integrarea cu Search & Discovery API**

În 2025, experiența de căutare a clientului este vitală. Aplicația noastră nu doar sincronizează date, ci le face "descoperibile". Utilizând API-ul pentru Filtre 31, putem crea programatic grupuri de filtre bazate pe Metafield-urile sincronizate.

- **Exemplu:** Dacă detectăm că un comerciant are metafield-uri de "Culoare" populate consistent, aplicația poate crea automat un filtru vizibil în storefront prin mutații GraphQL dedicate, eliminând configurarea manuală.

### **7.2 Observabilitate cu OpenTelemetry**

Node.js v24 are suport matur pentru OpenTelemetry. Sistemul va fi instrumentat complet:

- **Tracing:** Urmărirea unui webhook de la primire (Ingress), prin coada BullMQ, până la execuția DB și apelul API Shopify.  
- **Metrice:** Monitorizarea dimensiunii cozilor per grup (magazin), latența medie a job-urilor și rata de eroare a Bulk API.

---

**8\. Concluzie**

Arhitectura prezentată pentru lansarea din 18 decembrie 2025 nu este doar o colecție de tehnologii moderne, ci un răspuns strategic la provocările specifice ale e-commerce-ului la scară largă. Prin adoptarea **PostgreSQL 18.1** și a modelului său hibrid de date, eliminăm rigiditatea SQL fără a sacrifica integritatea. Prin utilizarea **Node.js v24 Streams** și a pipeline-urilor de ingestie "stitched", transformăm limitările Shopify Bulk API într-un avantaj operațional, permițând sincronizarea a milioane de produse cu un consum minim de resurse. În final, prin implementarea **BullMQ Pro** cu grupuri, garantăm o experiență echitabilă și performantă pentru toți utilizatorii, indiferent de dimensiunea catalogului lor. Aceasta este fundația unei aplicații pregătite să domine piața Shopify în 2026 și mai departe.

### **Lucrări citate**

1. Node.js | endoflife.date, accesată pe decembrie 18, 2025, [https://endoflife.date/nodejs](https://endoflife.date/nodejs)  
2. Node.js v24.12.0 (LTS), accesată pe decembrie 21, 2025, [https://nodejs.org/en/blog/release/v24.12.0](https://nodejs.org/en/blog/release/v24.12.0)  
3. PostgreSQL Versioning Policy, accesată pe decembrie 18, 2025, <https://www.postgresql.org/support/versioning/>  
4. PostgreSQL 18.1 Released (și update-uri pentru versiunile suportate), accesată pe decembrie 21, 2025, [https://www.postgresql.org/about/news/postgresql-181-177-1611-1515-1420-and-1323-released-3171/](https://www.postgresql.org/about/news/postgresql-181-177-1611-1515-1420-and-1323-released-3171/)  
5. Implement Multi-Tenancy in Medusa with PostgreSQL Row Level Security (Tech Guide), accesată pe decembrie 18, 2025, [https://www.rigbyjs.com/blog/multi-tenancy-in-medusa](https://www.rigbyjs.com/blog/multi-tenancy-in-medusa)  
6. PostgreSQL Row-level Security (RLS) Limitations and Alternatives \- Bytebase, accesată pe decembrie 18, 2025, [https://www.bytebase.com/blog/postgres-row-level-security-limitations-and-alternatives/](https://www.bytebase.com/blog/postgres-row-level-security-limitations-and-alternatives/)  
7. Redis 8.4 Release Notes, accesată pe decembrie 21, 2025, [https://redis.io/docs/latest/operate/oss_and_stack/release-notes/](https://redis.io/docs/latest/operate/oss_and_stack/release-notes/)  
8. PostgreSQL: JSON Types (docs), accesată pe decembrie 18, 2025, <https://www.postgresql.org/docs/current/datatype-json.html>  
9. Navigating the Data Seas: Understanding PostgreSQL's JSONB for Agile Data Modeling, accesată pe decembrie 18, 2025, [https://blog.dtdl.in/understanding-postgresqls-jsonb-0570489d620d](https://blog.dtdl.in/understanding-postgresqls-jsonb-0570489d620d)  
10. When To Avoid JSONB In A PostgreSQL Schema \- Heap.io, accesată pe decembrie 18, 2025, [https://www.heap.io/blog/when-to-avoid-jsonb-in-a-postgresql-schema](https://www.heap.io/blog/when-to-avoid-jsonb-in-a-postgresql-schema)  
11. Row Level Security for Tenants in Postgres | Crunchy Data Blog, accesată pe decembrie 18, 2025, [https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres](https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres)  
12. PostgreSQL: Row Security Policies (docs), accesată pe decembrie 18, 2025, <https://www.postgresql.org/docs/current/ddl-rowsecurity.html>  
13. 2025-01 release notes \- Shopify Dev Docs, accesată pe decembrie 18, 2025, [https://shopify.dev/docs/api/release-notes/2025-01](https://shopify.dev/docs/api/release-notes/2025-01)  
14. About REST Admin API versioning \- Shopify Dev Docs, accesată pe decembrie 18, 2025, [https://shopify.dev/docs/api/admin-rest/usage/versioning](https://shopify.dev/docs/api/admin-rest/usage/versioning)  
15. standardMetafieldDefinitionEnable \- GraphQL Admin \- Shopify Dev Docs, accesată pe decembrie 18, 2025, [https://shopify.dev/docs/api/admin-graphql/latest/mutations/standardMetafieldDefinitionEnable](https://shopify.dev/docs/api/admin-graphql/latest/mutations/standardMetafieldDefinitionEnable)  
16. How to develop an app with filtering capabilities?, accesată pe decembrie 18, 2025, [https://community.shopify.dev/t/how-to-develop-an-app-with-filtering-capabilities/6704](https://community.shopify.dev/t/how-to-develop-an-app-with-filtering-capabilities/6704)  
17. Shopify API limits, accesată pe decembrie 18, 2025, [https://shopify.dev/docs/api/usage/limits](https://shopify.dev/docs/api/usage/limits)  
18. Can bulkOperationRunQuery return all products from a store? \- Shopify Community, accesată pe decembrie 18, 2025, [https://community.shopify.com/t/can-bulkoperationrunquery-return-all-products-from-a-store/323340](https://community.shopify.com/t/can-bulkoperationrunquery-return-all-products-from-a-store/323340)  
19. How can we get product's all data with bulk query? \- \#2 by Liam \- Shopify Community, accesată pe decembrie 18, 2025, [https://community.shopify.com/c/graphql-basics-and/how-can-we-get-product-s-all-data-with-bulk-query/m-p/2364164](https://community.shopify.com/c/graphql-basics-and/how-can-we-get-product-s-all-data-with-bulk-query/m-p/2364164)  
20. Perform bulk operations with the GraphQL Admin API \- Shopify Dev Docs, accesată pe decembrie 18, 2025, [https://shopify.dev/docs/api/usage/bulk-operations/queries](https://shopify.dev/docs/api/usage/bulk-operations/queries)  
21. How can I stream a JSON Array from NodeJS to postgres \- Stack Overflow, accesată pe decembrie 18, 2025, [https://stackoverflow.com/questions/34687387/how-can-i-stream-a-json-array-from-nodejs-to-postgres](https://stackoverflow.com/questions/34687387/how-can-i-stream-a-json-array-from-nodejs-to-postgres)  
22. Efficient Data Import in PostgreSQL with Node.js | by Vincent Delacourt \- Medium, accesată pe decembrie 18, 2025, [https://vdelacou.medium.com/efficient-data-import-in-postgresql-with-node-js-12565826e51e](https://vdelacou.medium.com/efficient-data-import-in-postgresql-with-node-js-12565826e51e)  
23. Loading large amounts of data performantly using Node.js Streams \- Corey Cleary, accesată pe decembrie 18, 2025, [https://www.coreycleary.me/loading-tons-of-data-performantly-using-node-js-streams](https://www.coreycleary.me/loading-tons-of-data-performantly-using-node-js-streams)  
24. Unlimited Metaobject Output: Solving the Loop Limit in Shopify Liquid \- Clean Commit, accesată pe decembrie 18, 2025, [https://cleancommit.io/blog/unlimited-metaobject-output-solving-the-loop-limit-in-shopify-liquid/](https://cleancommit.io/blog/unlimited-metaobject-output-solving-the-loop-limit-in-shopify-liquid/)  
25. Increased limits in metafield and metaobject definitions \- Shopify developer changelog, accesată pe decembrie 18, 2025, [https://shopify.dev/changelog/increased-limits-for-metafields-and-metaobjects](https://shopify.dev/changelog/increased-limits-for-metafields-and-metaobjects)  
26. Rate limiting | BullMQ, accesată pe decembrie 18, 2025, [https://docs.bullmq.io/guide/rate-limiting](https://docs.bullmq.io/guide/rate-limiting)  
27. Rate limiting \- BullMQ, accesată pe decembrie 18, 2025, [https://docs.bullmq.io/bullmq-pro/groups/rate-limiting](https://docs.bullmq.io/bullmq-pro/groups/rate-limiting)  
28. Rate-Limit recipes in NodeJS using BullMQ \- Taskforce.sh Blog, accesată pe decembrie 18, 2025, [https://blog.taskforce.sh/rate-limit-recipes-in-nodejs-using-bullmq/](https://blog.taskforce.sh/rate-limit-recipes-in-nodejs-using-bullmq/)  
29. BulkOperation FAILED with partialDataUrl: Best practices for retrying failed records?, accesată pe decembrie 18, 2025, [https://community.shopify.dev/t/bulkoperation-failed-with-partialdataurl-best-practices-for-retrying-failed-records/21793](https://community.shopify.dev/t/bulkoperation-failed-with-partialdataurl-best-practices-for-retrying-failed-records/21793)  
30. "bulkOperationRunMutation" does not create all products \- Shopify Community, accesată pe decembrie 18, 2025, [https://community.shopify.com/t/bulkoperationrunmutation-does-not-create-all-products/258952](https://community.shopify.com/t/bulkoperationrunmutation-does-not-create-all-products/258952)  
31. Adding filters with Shopify Search & Discovery, accesată pe decembrie 18, 2025, [https://help.shopify.com/en/manual/online-store/storefront-search/search-and-discovery-filters](https://help.shopify.com/en/manual/online-store/storefront-search/search-and-discovery-filters)
