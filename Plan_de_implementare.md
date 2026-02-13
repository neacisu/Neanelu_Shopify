# Plan final de implementare Manager Shopify

Durată: 18 decembrie 2025 – … (iterativ, pe faze)
Locație: Monorepo public pnpm (open-source, licență MIT), sistem bare-metal (self-hosted) dev/staging/prod

1. Cuprins

2. Introducere

3. Faza F0: Preambul – Standarde DevOps și pregătire inițială

4. F0.1: Standarde inițiale și pregătirea mediului de dezvoltare

5. F0.2: Inițializare repository de cod și structura de bază a proiectului

6. Faza F1: Bootstrapping și Configurare Mediu Local (Săptămâna 1)

7. F1.1: Inițializare Monorepo și configurare pnpm

8. F1.2: Containerizare (Infrastructure as Code – mediu local)

9. F1.3: Standardizare Git Hooks (automatizare calitate cod)

10. F1.4: Skeleton CI/CD devreme (lint/typecheck/test + Docker smoke)

11. Faza F2: Data Layer și Schema Design (Săptămâna 2)

12. F2.1: Configurare ORM/Query Builder pentru baza de date

13. F2.2: Definirea schemelor și migrații inițiale (incl. RLS pentru multi-tenant)

14. F2.3: Scripturi de seed (populare inițială a datelor pentru teste)

15. Faza F3: Core Backend & Shopify Auth (Săptămâna 3)

16. F3.1: Configurare server Node.js (Fastify) și setări de bază

17. F3.2: Implementare OAuth 2.0 (acces offline) cu Shopify și stocare token

18. F3.3: Endpoint de Webhooks (validare HMAC și enqueuing evenimente)

19. F3.4: Observabilitate HTTP & Webhooks (OTel early)

20. Faza F4: Infrastructura de procesare asincronă (Săptămâna 4)

21. F4.1: Configurare cozi distribuite BullMQ Pro

22. F4.2: Implementare fairness multi-tenant (grupare cozi pe magazin)

23. F4.3: Rate limiting distribuit (limite API per magazin prin Redis + Lua)

24. F4.4: Observabilitate cozi & worker (spans/metrici BullMQ)

25. Faza F5: Pipeline-ul de ingestie „Stitched” (Săptămâna 6-7)

26. F5.1: Orchestrare Shopify Bulk Ops (query + mutation, multi-tenant safe)

27. F5.2: Pipeline streaming JSONL → transform → COPY (Postgres)

28. F5.3: Observabilitate ingestie & bulk

29. F5.4: Testing & hardening (CI-friendly)

30. Faza F6: Integrare AI & Vector Search (Săptămâna 8)

31. F6.1: Integrare OpenAI pentru generare embeddings (procesare batch)

32. F6.2: Căutare vectorială cu pgvector (PostgreSQL) - Source of Truth pentru vector search

33. Faza F7: CI/CD, Observabilitate și Producție (Săptămâna 10-11)

34. F7.0: Foundation Producție (platformă, medii, Ops, secrete)

35. F7.1: Observabilitate prod (OTel Collector, SLO, dashboards)

36. F7.2: Build & Supply Chain (Docker multi-stage, SBOM, semnare)

37. F7.3: CI/CD complet (Gating, Zero-downtime migrations, SSH Auth)

38. F7.4: Data Safety & DR (PITR, Backup drills, Kill-switches)

39. F7.5: Production Readiness (SRE, Autoscaling, Runbooks)

40. Faza F8: Extensii Avansate (Opțional, Post-MVP)

41. Sprint Plan: Execuție și PR-uri (76 PRs, 11 Săptămâni)

## 1. Introducere

Documentația aferentă proiectului Manager Shopify cuprinde mai multe materiale ce descriu arhitectura și planul de implementare pentru o aplicație Shopify de tip enterprise, capabilă să gestioneze un volum masiv de date (peste 1 milion de SKU-uri). Analiza critică a acestor documente evidențiază atât o viziune unitară, cât și unele inadvertențe și erori ce trebuie reconciliate în planul final: - Structura pe faze și sub-faze: Planul tehnic este împărțit în etape DevOps (Faze F0–F7 în prezentul document) ce progresează de la configurarea mediului de dezvoltare, la implementarea stratului de date, logica de business, integrarea AI și, în final, livrarea în producție cu CI/CD și monitorizare. Documentul „Plan Implementare Aplicație Completă” prezintă o structurare similară (Faza 1–6), însă cu o grupare ușor diferită a priorităților (de exemplu, guvernanța multi-tenant și echitatea resurselor apar ca fază separată spre final, pe când în planul DevOps acestea sunt adresate mai devreme, în faza de infrastructură asincronă). Pentru coerentizare, planul final aliniază aceste faze într-o secvență logică F0–F7 care acoperă toate aspectele.

    - Stiva tehnologică și alegeri de implementare: Toate materialele converg spre un stack modern orientat pe performanță: Node.js v24 LTS (Krypton) pentru server, **PostgreSQL 18.1** pentru baza de date relațională (inclusiv **pgvector** pentru vector search), **Redis 8.4.0** pentru cache, cozi BullMQ și rate limiting (NU pentru vector storage), și un monorepo JavaScript/TypeScript gestionat cu pnpm. Testare standardizată: **backend (apps/backend-worker) rulează pe `node:test` + `node --watch --test`**, iar **frontend (apps/web-admin) rulează pe Vitest (ecosistem Vite/RR7)**; **Jest nu este folosit**. Se pune accent pe instrumente moderne: BullMQ Pro pentru cozi distribuite și fairness multi-tenant, OpenTelemetry pentru observabilitate și integrarea OpenAI pentru capabilități AI. Totuși, există inconsistențe notabile în descrierea unora dintre aceste alegeri:

    - ORM și gestionarea bazei de date: Standardul proiectului este **Drizzle ORM** (pentru acces tipizat la PostgreSQL) împreună cu **drizzle-kit** pentru migrații SQL. Abordarea păstrează migrațiile SQL ca sursă de adevăr, ceea ce ajută la funcționalități avansate precum Row Level Security (RLS) și la control operațional mai bun în producție.

    - Framework front-end vs. backend combinat: Documentația discută fuziunea Remix cu React Router (contextul anului 2025) și posibilitatea utilizării șablonului oficial Shopify App (bazat pe Remix) pentru front-end. În același timp, structura proiectului evidențiază un front-end React separat (admin UI integrată în Shopify via iframe) în folderul apps/web-admin, distinct de serviciul backend Node.js din apps/backend-worker. Planul final clarifică abordarea: se folosește un front-end React standalone (React Router v7) pentru interfața de administrare (embedded în Shopify), în timp ce backend-ul Node (Fastify) gestionează API-urile și procesările asincrone. S-a considerat alternativă utilizarea Remix pentru a unifica front-end-ul cu backend-ul, însă s-a optat pentru separare pentru o modularitate mai bună și control sporit al performanței.

    - Nume și structură de proiect: În documente apar denumiri ușor diferite pentru aceleași componente (ex: serviciul backend este numit apps/web în planul DevOps și apps/backend-worker în structura de proiect). Planul final adoptă nomenclatura din structura actuală a codului (backend-worker pentru serviciul Node principal, respectiv web-admin pentru front-end), asigurând consistența în tot documentul.

    - Aspecte omise sau implicite: Unele detalii apar într-un document și lipsesc în altele, necesitând integrare: de exemplu, planul DevOps include configurarea hooks Git (Husky) și testare automatizată, aspecte neabordate direct în raportul arhitectural, dar esențiale pentru calitatea codului; invers, raportul complet discută pe larg guvernanța multi-tenant (asigurarea că niciun magazin Shopify nu monopolizează resursele comune), ceea ce în planul tehnic DevOps este tratat la nivel practic (strategie de fairness în coada BullMQ și politici RLS în Postgres). Planul final explicită toate aceste elemente, adăugând pași concreți pentru implementarea lor.

    - Erori minore și corectitudinea planificării: S-au identificat câteva greșeli de redactare și potențiale probleme logice: de pildă, termenul “Migrații Initiale” apare scris fără diacritice într-un document, iar într-altul cu diacritice (“Migrații Inițiale”); un alt exemplu este utilizarea sintagmei “See” în loc de “Seed” într-o secțiune, probabil din cauza unei erori de transcriere. De asemenea, în documentație au existat mențiuni amestecate de versiuni PostgreSQL (15/16/18). În acest plan, stiva este standardizată și pin-uită pe **PostgreSQL 18.1** pentru reproductibilitate (inclusiv în exemplele de Docker). Din perspectivă logică, secvența de faze este solidă, acoperind treptat toate cerințele. O potențială îngrijorare este volumul mare de date și timpii de execuție (ex.: actualizarea 1M produse ar dura ~5,7 zile la 2 req/sec dacă s-ar folosi API-uri sincrone standard, conform analizei), fapt ce justifică pe deplin abordările asincrone propuse (Bulk Operations și pipeline de streaming) – planul final le include ca element central.

În concluzie, planul final unifică perspectivele diferitelor documente într-o strategie coerentă de implementare. În cele ce urmează este prezentat Planul final de implementare Manager Shopify, structurat pe faze F0–F7, fiecare împărțită în sub-faze (ex. F1.2 indică sub-faza 2 din Faza 1) și detaliată la nivel de task-uri granular. Fiecare task este descris în format JSON – incluzând numele, descrierea detaliată, locația de implementare în proiect, contextul anterior, criteriile de validare/testare, rezultatul așteptat și restricții explicite pentru a evita orice deviație de la scopul definit. Acest plan este redactat în limba română, ca document formal DevOps, și poate fi folosit atât de ingineri pentru implementare, cât și de agenți automatizați pentru a parcurge pașii în mod controlat.

### Dependency Graph (CONFORM AUDIT 2025-12-26)

Graficul de mai jos arată dependențele critice între faze:

```mermaid
graph TD
    subgraph "Foundation"
        F0[F0: Preambul DevOps]
        F1[F1: Setup & Infrastructure]
    end

    subgraph "Data Layer"
        F2[F2: Database & Migrations]
    end

    subgraph "Core Services"
        F3[F3: Shopify Integration]
        F4[F4: Async Engine]
    end

    subgraph "Business Logic"
        F5[F5: Bulk Operations]
        F6[F6: AI & PIM]
    end

    subgraph "Operations"
        F7[F7: CI/CD & Observability]
        F8[F8: Future Extensions]
    end

    F0 --> F1
    F1 --> F2
    F2 --> F3
    F2 --> F4
    F3 --> F5
    F4 --> F5
    F5 --> F6
    F6 --> F7
    F7 --> F8

    F2 -.->|RLS prerequisite| F3
    F4 -.->|BullMQ Groups| F5
    F2 -.->|pgvector schema| F6
```

**Critical Path:** F0 → F1 → F2 → F3/F4 → F5 → F6 → F7

**Parallel Opportunities:**

- F3 (Shopify Integration) și F4 (Async Engine) pot fi dezvoltate în paralel după F2
- F7.6 (Frontend Quality) poate fi dezvoltat în paralel cu F5/F6 backend

## Addendum (Dec 2025): Descoperiri validate în research (TypeScript)

Acest addendum reflectă lucrurile pe care le-am validat practic în research (implementat în TypeScript și comparat determinist cu Python), care influențează direct cum trebuie scrise task-urile din fazele F3–F5.

### A. Shopify Admin GraphQL: autentificare în mediu headless

- În medii headless/Ubuntu, Shopify CLI login poate fi blocat/instabil. Pentru research am folosit un flow manual OAuth (captură `code` + exchange la endpoint-ul Shopify `/admin/oauth/access_token`) ca să obținem token.
- Implicație pentru F3.2: în producție NU ne bazăm pe CLI pentru auth; implementăm OAuth end-to-end în `apps/backend-worker` (start/callback + state/HMAC) și persistăm token-ul criptat în DB.
- Restricție de securitate: token-urile folosite în research nu se comit. Orice fișiere de tip `.env*` cu secrete sunt ignorate în Git și se păstrează doar local/în secret manager.

### B. Bulk Operations export: format JSONL și relația Product ↔ Variant

- Exportul Bulk Ops produce fișier JSONL foarte mare (sute de MB) cu linii separate pentru `Product` și `ProductVariant`.
- Varianta NU este neapărat imbricată în produs; legătura se face prin câmpul `__parentId` (variant → product).
- Implicație pentru F5.2 (streaming): pipeline-ul de ingestie trebuie să trateze JSONL ca stream și să „stitch-uiască” relațiile părinte-copil folosind `__parentId` (nu presupunem că liniile sunt grupate perfect și nu ținem totul în RAM).

### C. Determinism: selecții stabile pentru debugging și parity

- Pentru reproducibilitate, sampling-ul trebuie să fie deterministic (fără random):
  - vendor pick determinist pe „alphabet buckets” (`A-Z` + `#`), alegând primul vendor per bucket în ordine.
  - produs pick determinist: primele N produse în ordinea apariției în JSONL pentru vendor.
- Implicație: orice test/raport de parity (Python vs TS) folosește aceeași selecție deterministă ca să evite drift.

### D. „TOT / everything fetch”: query generator bazat pe schema (Admin GraphQL 2025-10)

- Pentru a „citi tot ce se poate” despre un produs, am validat un mod de query generation bazat pe schema introspection, care enumeră câmpurile tipului `Product` și construiește un query stabil.
- Pentru conexiuni cu paginare (ex: `metafields(first: 250, after: ...)`), am validat paginare completă până la epuizare și am produs explicit:
  - `metafieldsCountFetched`
  - `variantsCountFetched`
- Implicație: implementarea finală trebuie să includă un generator robust (nu „hardcoded fields” care se degradează la versiuni API noi) și să trateze paginările mari în mod sigur.

### E. Limitare importantă: app-owned metafields nu sunt vizibile în afara contextului aplicației

- Metafield-urile cu namespace de tip `app--<id>--...` sunt accesibile doar în contextul aplicației care le deține.
- Un token obținut prin staff/Admin UI sau altă aplicație nu poate citi aceste metafield-uri (rezultatul poate fi gol chiar dacă există date).
- Implicație pentru modelul de date și ingestie:
  - datele „app-owned” trebuie citite de aplicația owner (token-ul aplicației, scopes corecte) sau replicate în DB în mod controlat.
  - nu presupunem că „fetch all metafields” va include și aceste namespace-uri.

### F. Convenții TS în research (rulează doar cu pnpm)

- Scripturile TypeScript se rulează prin `pnpm exec tsx` (ESM-friendly), fără a impune tool-uri globale.
- Output-urile research sunt separate și nu se comit (artefacte mari/generate).

### G. Cost & Performance Estimates (CONFORM AUDIT 2025-12-26)

**Estimări pentru operații 1M+ SKU:**

| Operație              | Timp Estimat           | Cost API         | Note                         |
| --------------------- | ---------------------- | ---------------- | ---------------------------- |
| Full Sync 1M products | ~5.7 zile la 2 req/sec | ~50K cost points | Bulk Operations reduc la ore |
| Bulk Export 1M        | 2-4 ore                | ~1000 points/op  | Streaming JSONL              |
| Bulk Import 1M        | 2-4 ore                | ~1000 points/op  | pg-copy-streams              |
| Embedding 1M products | ~24h batch             | $50-100 OpenAI   | Batch API 50% discount       |

**Estimări Infrastructure (bare metal):**

| Componenta        | Specificații Minime         | Cost/lună (estimate) |
| ----------------- | --------------------------- | -------------------- |
| PostgreSQL Server | 32GB RAM, 4 cores, 1TB NVMe | $150-300             |
| Redis Server      | 16GB RAM, 2 cores           | $50-100              |
| API/Worker Server | 16GB RAM, 4 cores           | $100-200             |
| Backup Storage    | 2TB S3-compatible           | $40-80               |
| **Total estimat** | -                           | **$340-680/lună**    |

**Metrici performanță target:**

| Operație              | Latență Target | Throughput Target |
| --------------------- | -------------- | ----------------- |
| Webhook ingress (p99) | <200ms         | 1000/min/shop     |
| Bulk ingest rate      | -              | >50 products/sec  |
| Vector search (p99)   | <50ms          | 100 queries/sec   |
| Dashboard load        | <2s            | -                 |

> [!NOTE]
> Aceste estimări sunt bazate pe research și trebuie validate în F7.5.4 (SRE Review 10K SKU).

Faza F0: Preambul – Standarde DevOps și pregătire inițială
Durată: Pregătire inițială (înainte de startul implementării)
Obiectiv: Stabilirea mediului de lucru și a convențiilor standard (versiuni platformă, unelte, structură de proiect), astfel încât dezvoltarea să înceapă pe baze solide și uniforme pentru toți membrii echipei.

### F0.1: Standarde inițiale și pregătirea mediului de dezvoltare

    ```JSON
    {
        "id_task": "F0.1.1",
        "denumire_task": "Verificare și instalare Node.js versiunea 24 LTS",
        "descriere_task": "Verifică versiunea Node.js instalată pe stația de dezvoltare. Dacă versiunea curentă nu este 24.x LTS (Krypton), instalează Node.js v24.12.0 LTS folosind nvm (Node Version Manager) sau instalatorul oficial. Asigură-te că Node.js 24 devine versiunea implicită în sesiunea de dezvoltare.",
        "cale_implementare": "Mediul local de dezvoltare (global)",
        "contextul_anterior": "Nu au fost încă configurate tool-urile de dezvoltare; este necesar să existe versiunea corectă de Node.js instalată înainte de a începe proiectul.",
        "validare_task": "Rulează `node -v` în terminal și verifică faptul că versiunea raportată este 24.x (de ex. `v24.12.0`). Confirmă că nu există erori la rularea comenzii.",
        "outcome_task": "Mediul de dezvoltare are instalată versiunea Node.js LTS 24, gata de utilizare pentru proiect.",
        "restrictii_antihalucinatie": "Nu instala o versiune diferită de Node.js față de cea specificată. Nu continua implementarea dacă Node.js 24 nu este disponibil cu succes."
    },

    {
        "id_task": "F0.1.2",
        "denumire_task": "Instalare și verificare pnpm (Package Manager) v10.x",
        "descriere_task": "Instalează pnpm (managerul de pachete) la nivel global dacă nu este deja instalat. Asigură-te că versiunea pnpm este **10.0.0 sau mai nouă** (versiunea curentă LTS, decembrie 2025). Instalează pnpm global folosind **exclusiv corepack** (recomandat Node.js 24):\n```bash\ncorepack enable && corepack prepare pnpm@latest --activate\n```\nDupă instalare, confirmă versiunea cu `pnpm -v`.",
        "cale_implementare": "Mediul local de dezvoltare (global)",
        "contextul_anterior": "Node.js 24 este disponibil în mediu. Următorul pas este să asigurăm un manager de pachete compatibil (pnpm) pentru monorepo-ul proiectului.",
        "validare_task": "Rulează `pnpm -v` și verifică afișarea versiunii (trebuie să fie >= 10.0.0, ideal 10.26.1+). De asemenea, verifică că pnpm poate rula comenzi (ex: `pnpm help` funcționează fără erori).",
        "outcome_task": "Managerul de pachete pnpm 10.x este instalat global și pregătit pentru utilizare, respectând versiunea minimă solicitată.",
        "restrictii_antihalucinatie": "Nu instala alte pachete în acest pas. Nu folosi un alt manager de pachete (npm/yarn) în loc de pnpm. NU accepta versiuni pnpm sub 10.0.0 - proiectul necesită funcționalitățile din pnpm 10 (catalogs, peer resolution îmbunătățit)."
    },

    {
        "id_task": "F0.1.3",
        "denumire_task": "Verificare existență Docker și instalare dacă e necesar",
        "descriere_task": "Verifică dacă Docker (Docker Engine și Docker Compose) este instalat pe mașina locală. Dacă nu, instalează Docker Desktop sau Docker Engine pentru sistemul de operare curent. Asigură-te că serviciul Docker rulează și că Docker Compose este disponibil (de regulă integrat ca subcomandă `docker compose`).",
        "cale_implementare": "Mediul local de dezvoltare (global)",
        "contextul_anterior": "Uneltele de bază (Node.js și pnpm) sunt configurate. Pentru a orchestra servicii precum baza de date și cache-ul local, este nevoie de Docker.",
        "validare_task": "Rulează `docker --version` și `docker compose version`. Confirmă că ambele comenzi afișează versiuni, indicând instalarea cu succes a Docker Engine și Docker Compose. Verifică rulând `docker run hello-world` că un container se poate porni (test de sănătate Docker).",
        "outcome_task": "Docker este instalat și funcțional pe mediul de dezvoltare, permițând utilizarea containerelor pentru servicii auxiliare (Postgres, Redis etc.).",
        "restrictii_antihalucinatie": "Nu continua fără Docker funcțional dacă aplicația are nevoie de containere. Nu modifica setările Docker în afara instalării standard. Nu porni containere ale aplicației înainte de a configura fișierele dedicate."
    },

    {
        "id_task": "F0.1.4",
        "denumire_task": "Creare fișier de versiune Node (.nvmrc) în proiect",
        "descriere_task": "Creează un fișier denumit `.nvmrc` în rădăcina depozitului de cod al proiectului (`/Neanelu_Shopify`). În acest fișier, specifică versiunea Node.js utilizată de proiect (ex: `v24.12.0`). Acest fișier va ajuta colaboratorii care folosesc **nvm** să seteze automat versiunea corectă de Node când intră în directorul proiectului.",
        "cale_implementare": "/Neanelu_Shopify/.nvmrc",
        "contextul_anterior": "Mediul global a fost pregătit cu Node 24. Pentru consistență, proiectul trebuie să declare explicit versiunea Node necesară.",
        "validare_task": "Deschide fișierul `.nvmrc` și verifică faptul că acesta conține exact identificatorul versiunii Node LTS (e.g. `v24.12.0`). Utilizează comanda `nvm use` în directorul proiectului și confirmă că versiunea Node este comutată conform fișierului.",
        "outcome_task": "Fișierul `.nvmrc` este prezent la rădăcina proiectului, indicând versiunea Node corespunzătoare (v24.x) pentru toți dezvoltatorii.",
        "restrictii_antihalucinatie": "Nu include alt text sau comentarii în `.nvmrc` în afara versiunii. Nu utiliza alt format (de exemplu, versiune fără 'v') decât cel standard cerut de nvm. Nu trece la pasul următor fără acest fișier în depozit."
    },

    {
        "id_task": "F0.1.5",
        "denumire_task": "Creare fișier de configurare pnpm (.npmrc) COMPLET la rădăcina proiectului - OBLIGATORIU",
        "descriere_task": "Crează fișierul `.npmrc` în directorul rădăcină al proiectului cu următoarele setări **OBLIGATORII**:\n\n```\n# ============================================\n# PNPM CORE SETTINGS\n# ============================================\n# Compatibilitate React Router 7 și Shopify Vite Plugins\nshamefully-hoist=true\n\n# Gestionare automată peer dependencies\nauto-install-peers=true\n\n# Forțare respectare versiuni engine din package.json\nengine-strict=true\n\n# Dezactivează erori stricte peer (pentru flexibilitate ecosistem)\nstrict-peer-dependencies=false\n\n# ============================================\n# REGISTRY PRIVAT - BULLMQ PRO\n# ============================================\n@taskforcesh:registry=https://npm.taskforce.sh/\n//npm.taskforce.sh/:_authToken=${NPM_TASKFORCESH_TOKEN}\nalways-auth=true\n\n# ============================================\n# PNPM CATALOGS (DECIZIE EXPLICITĂ)\n# ============================================\n# DECIZIE: NU folosim pnpm catalogs în această fază.\n# Motivație: proiectul este nou, catalogs adaugă complexitate\n# nejustificată; în F2+ se poate reconsidera pentru pinning\n# cross-workspace al versiunilor comune (ex: React, TypeScript).\n# Dacă se decide utilizarea catalogs, adaugă în package.json:\n# \"pnpm\": { \"catalogs\": { \"default\": { \"react\": \"^19.0.0\" } } }\n```\n\n**IMPORTANT:** Token-ul NPM_TASKFORCESH_TOKEN NU se comite niciodată - vine din variabile de mediu sau secret manager.",
        "cale_implementare": "/Neanelu_Shopify/.npmrc",
        "contextul_anterior": "Versiunile de Node și pnpm sunt stabilite. Fișierul .npmrc TREBUIE configurat complet înainte de primul `pnpm install` pentru a evita eșecuri de instalare și drift de dependențe.",
        "validare_task": "Deschide `.npmrc` și CONFIRMĂ prezența TUTUROR setărilor obligatorii: shamefully-hoist=true, auto-install-peers=true, engine-strict=true, strict-peer-dependencies=false, always-auth=true, și configurația registry-ului @taskforcesh. Rulează `pnpm config list` pentru a verifica că setările sunt încărcate corect.",
        "outcome_task": "Fișierul `.npmrc` este prezent cu TOATE configurațiile obligatorii (inclusiv always-auth și decizia explicită privind catalogs), asigurând instalarea corectă a dependențelor.",
        "restrictii_antihalucinatie": "NU omite niciuna dintre setările obligatorii. NU comite token-uri sau secrete în fișier - folosește întotdeauna variabile de mediu (${NPM_TASKFORCESH_TOKEN}). NU continua fără acest fișier complet configurat. DECIZIA privind pnpm catalogs este DOCUMENTATĂ EXPLICIT."
    },

    {
        "id_task": "F0.1.6",
        "denumire_task": "Stabilirea constrângerilor de versiune în `package.json` (engines)",
        "descriere_task": "Planifică adăugarea constrângerilor de versiune pentru Node.js și pnpm în viitorul fișier `package.json` al proiectului. Conținut obligatoriu pentru secțiunea 'engines':\n- 'node': '>=24.0.0'\n- 'pnpm': '>=10.0.0'\n\nAcest pas se documentează acum pentru a fi aplicat imediat ce fișierul `package.json` este creat, asigurându-ne că orice dezvoltator care folosește o versiune nepotrivită primește o EROARE (nu doar avertisment) la instalare, datorită `engine-strict=true` din .npmrc.",
        "cale_implementare": "N/A (configurație ce va fi adăugată în package.json la inițializare)",
        "contextul_anterior": "Setările pnpm și Node au fost pregătite, inclusiv engine-strict=true în .npmrc. Urmează definirea metadatelor proiectului; înainte de a inițializa package.json, determinăm convențiile de versiune ce vor fi incluse acolo.",
        "validare_task": "Verificarea acestei convenții se va realiza după crearea `package.json`. Va trebui să conțină secțiunea 'engines' cu valorile prestabilite (>=24 pentru node, >=10 pentru pnpm). Testează că instalarea cu versiuni mai vechi eșuează datorită engine-strict.",
        "outcome_task": "Cerințele minime de versiune pentru runtime (Node 24+) și managerul de pachete (pnpm 10+) sunt stabilite și vor fi integrate în configurarea proiectului, PREVENIND incompatibilități de mediu prin erori de instalare.",
        "restrictii_antihalucinatie": "Nu omite adăugarea acestor constrângeri la crearea `package.json`. NU specifica versiuni mai vechi (Node 22, pnpm 9) care nu respectă stack-ul actual. Valorile TREBUIE să fie >=24 pentru Node și >=10 pentru pnpm."
    },

    {
        "id_task": "F0.1.7",
        "denumire_task": "Documentarea stivei tehnologice și a convențiilor de proiect",
        "descriere_task": "Creează o documentație internă (de exemplu, un fișier README sau o pagină în wiki-ul proiectului) în care să fie enumerate tehnologiile alese și versiunile lor (Node 24, PostgreSQL 18.1, Redis 8.4.0 cu RedisJSON/RediSearch, pnpm 10, etc.), precum și convențiile de dezvoltare agreate: utilizarea monorepo, modul de versionare semantică a aplicației, stilul de cod (folosirea TypeScript, convenții de naming, formatare, linting) și fluxul de lucru Git (branch-uri, code review). Scopul este ca toți membrii echipei să înțeleagă contextul tehnologic și regulile de bază înainte de a scrie cod.",
        "cale_implementare": "/Neanelu_Shopify/README.md (sau Wiki intern al proiectului)",
        "contextul_anterior": "Au fost stabilite setările de bază ale mediului. Este util ca aceste decizii să fie comunicate oficial echipei pentru aliniere.",
        "validare_task": "Revizuiește documentul creat și asigură-te că listează corect toate tehnologiile (inclusiv versiuni și link-uri spre documentația relevantă) și convențiile. Obține acordul echipei (sau al arhitectului responsabil) asupra acestor detalii. Validarea se consideră reușită dacă documentul este complet și aprobat, fără neclarități.",
        "outcome_task": "Documentația internă inițială este disponibilă, descriind stack-ul tehnologic și regulile de dezvoltare, oferind astfel un ghid clar înainte de startul implementării.",
        "restrictii_antihalucinatie": "Nu adăuga tehnologii neaprobate în document. Nu omite elemente cheie ale stivei (dacă ceva este decis în plan, trebuie reflectat în document). Nu continua cu pașii următori până ce documentarea nu este confirmată de factorii de decizie."
    },

    {
        "id_task": "F0.1.8",
        "denumire_task": "Planificarea structurii de directoare pentru monorepo",
        "descriere_task": "Stabilește și notează structura de directoare a proiectului monorepo, conform cerințelor aplicației. Se va folosi o structură cu două directoare principale: `apps/` (conținând aplicațiile executabile, ex. front-end-ul admin și serviciul back-end/worker) și `packages/` (conținând modulele partajate: ex. pachetul de acces la DB, pachetul client Shopify, motorul AI etc.). În cadrul acestei planificări, decide denumirile specifice: de exemplu, `apps/web-admin` pentru front-end (React) și `apps/backend-worker` pentru serviciul Node back-end, respectiv `packages/database`, `packages/shopify-client`, `packages/queue-manager`, `packages/ai-engine` pentru pachetele comune. Documentează acest arbore de directoare planificat astfel încât pasul de inițializare a proiectului să poată crea aceste foldere corect.",
        "cale_implementare": "Structura proiectului (design, în document intern)",
        "contextul_anterior": "Avem convențiile generale stabilite. Urmează să organizăm proiectul; înainte de a crea efectiv directoarele, definim clar ce structuri vom avea, evitând reorganizări ulterioare.",
        "validare_task": "Verifică planul de structură comparându-l cu cerințele proiectului. Asigură-te că fiecare componentă majoră a sistemului (frontend, backend, servicii auxiliare) are un loc în structură. Recitește documentul de arhitectură (dacă există) pentru a confirma că nu lipsește vreun modul. Confirmarea acestui pas este dată de existența unei schițe agreate a structurii (de exemplu sub forma unei liste ierarhice în documentație).",
        "outcome_task": "Există o schemă clară a structurii monorepo, împărțită pe aplicații și pachete, aliniată cu nevoile proiectului. Echipa știe exact ce directoare vor fi create și ce va conține fiecare.",
        "restrictii_antihalucinatie": "Nu crea efectiv directoarele în acest pas (este doar planificare). Nu introduce nume de module care nu au fost discutate sau care nu reflectă funcționalitățile necesare. Nu trece mai departe până când structura propusă nu este clarificată și aprobată."
    },

    {
        "id_task": "F0.1.9",
        "denumire_task": "Stabilirea convențiilor de ramificare Git și flux de lucru",
        "descriere_task": "Definește modul în care se va folosi sistemul de control al versiunilor (Git) pe parcursul dezvoltării. Hotărăște numele ramurii principale (ex. `main`) și dacă se vor folosi ramuri separate pentru feature-uri, bugfix-uri, release-uri (GitFlow vs. trunk based development). De exemplu, convenim că dezvoltarea se face pe ramuri feature derivate din `main`, care apoi sunt integrate prin *pull request*-uri cu review de cod. Documentează aceste convenții într-o secțiune a README-ului sau wiki-ului (ex: „Workflow Git”) pentru ca toți dezvoltatorii să le urmeze uniform.",
        "cale_implementare": "Configurare repo (setări GitHub) și documentație proiect",
        "contextul_anterior": "Proiectul este pe cale să fie inițiat ca depozit Git. Este important să existe reguli clare de colaborare înainte de prima commit și înainte ca mai mulți contributori să înceapă lucrul.",
        "validare_task": "Verifică în setările repository-ului (dacă e deja creat pe platforma de git hosting, ex. GitHub) că ramura principală este setată corect (nume și eventual protecții). Asigură-te că documentul intern specifică clar convențiile. Dacă există un repository remote, confirmă că informația despre workflow este publicată pentru toți colaboratorii.",
        "outcome_task": "Fluxul de lucru Git este definit și comunicat: dezvoltatorii știu cum să creeze și să integreze ramuri de cod, reducând riscul de conflicte și asigurând un ciclu de livrare ordonat.",
        "restrictii_antihalucinatie": "Nu configura reguli de branch protection sau workflows automatizate în acest pas (decât dacă sunt imediat necesare; altfel se vor face la faza CI/CD). Nu lăsa neclarități în descrierea convențiilor (toți trebuie să înțeleagă exact procesul)."
    },

    {
        "id_task": "F0.1.10",
        "denumire_task": "Selectarea și pregătirea instrumentelor de calitate a codului (linters/formatare)",
        "descriere_task": "Alege setul de instrumente pentru asigurarea calității codului: de exemplu **ESLint** (cu un config adecvat pentru proiectul nostru Node + React + TypeScript) și **Prettier** pentru formatare consistentă. Stabilește că aceste tool-uri vor fi integrate în pipeline-ul de dezvoltare (hooks Git și CI). Documentează convențiile de cod specifice (ex: stil Airbnb, reguli custom pentru importuri, folosirea `semi` etc.). Nu instala încă aceste pachete, dar pregătește configurațiile necesare (de exemplu, un fișier de configurare `.eslintrc.json` și `.prettierrc`) pe care le vei adăuga efectiv odată ce repository-ul este inițializat. Scopul acestui pas este să nu amâni deciziile privind calitatea codului – ele sunt luate anticipat.",
        "cale_implementare": "Fișiere de configurare planificate pentru linters (viitoare .eslintrc, .prettierrc)",
        "contextul_anterior": "Workflow-ul de colaborare este stabilit. Înainte de a începe să scriem cod, ne asigurăm că avem instrumente de calitate a codului alese și reguli clare, pentru a preveni probleme stilistice și de calitate pe parcurs.",
        "validare_task": "Asigură-te că regulile dorite sunt bine definite. De exemplu, decide dacă vei folosi ESLint cu configurația recomandată de Airbnb sau Google și dacă vei integra Prettier cu ESLint. Un mod de validare: scrie un exemplu de cod deliberat neformatat și gândește ce reguli ar trebui să se aplice – verifică dacă setul ales acoperă aceste situații. Finalizarea acestui pas rezultă într-o listă de pachete de instalat și un draft al fișierelor de configurare pentru ESLint/Prettier, gata de implementare în faza următoare.",
        "outcome_task": "Strategia de asigurare a calității codului este definită (tool-urile de linting și formatare, împreună cu regulile dorite), permițând implementarea rapidă a acestora odată ce structura proiectului este creată.",
        "restrictii_antihalucinatie": "Nu instala încă pachetele de lint/format (acest pas este pregătitor). Nu impune reguli de cod contradictorii cu stack-ul (ex: nu activa reguli de browser pentru un proiect Node). Nu ignora importanța acestui pas – nu continua fără a clarifica instrumentele de calitate."
    },

    {
        "id_task": "F0.1.11",
        "denumire_task": "Monitorizare compatibilitate API Shopify 2025-10 + strategie fallback",
        "descriere_task": "**CONFORM AUDIT 2025-12-26:** Documentează strategia de compatibilitate pentru versiuni API speculative:\n\n**Versiune curentă target:** 2025-10 (Release Q4 2025)\n\n**Strategie Fallback:**\n1. **Monitorizare:** Urmărește Shopify changelog pentru breaking changes\n2. **Fallback version:** 2025-07 (stabil, testat)\n3. **Environment variable:** `SHOPIFY_API_VERSION=2025-10` cu fallback la `2025-07`\n\n**Implementare în packages/config:**\n```typescript\nexport const SHOPIFY_API_VERSION = \n  process.env.SHOPIFY_API_VERSION || '2025-10';\n\nexport const SHOPIFY_FALLBACK_VERSION = '2025-07';\n\nexport function getApiVersion(): string {\n  // La erori de compatibilitate, folosește fallback\n  return SHOPIFY_API_VERSION;\n}\n```\n\n**Acțiuni la incompatibilitate:**\n- Schimbă `SHOPIFY_API_VERSION` la `2025-07` în .env\n- Log și alertă pentru investigare\n- Deschide issue pe GitHub pentru tracking",
        "cale_implementare": "/Neanelu_Shopify/packages/config/src/shopify.ts",
        "contextul_anterior": "Versiunile pinned (Postgres 18.1, Redis 8.4, Node 24) sunt stabile. API Shopify 2025-10 e speculativă.",
        "validare_task": "1. SHOPIFY_API_VERSION e configurabil din env\n2. Fallback la 2025-07 funcționează\n3. Documentația menționează strategia",
        "outcome_task": "Proiectul are strategie clară pentru versiuni API viitoare.",
        "restrictii_antihalucinatie": "NU presupune că 2025-10 va fi 100% compatibil. DOCUMENTEAZĂ fallback explicit."
    }
    ]
    ```

### F0.2: Inițializare repository de cod și structura de bază a proiectului

    ```JSON
    {
        "id_task": "F0.2.1",
        "denumire_task": "Inițializare depozit Git local pentru proiect",
        "descriere_task": "Inițializează un nou depozit Git în directorul proiectului (`/Neanelu_Shopify`). Rulează comanda `git init` pentru a crea structurile interne Git. Acest pas pornește versionarea codului la nivel local. Asigură-te că numele implicit al ramurii principale este `main` (dacă nu, redenumește ramura implicită în `main` pentru consistență cu convențiile stabilite).",
        "cale_implementare": "/Neanelu_Shopify (rădăcina proiectului)",
        "contextul_anterior": "Structura și convențiile proiectului au fost planificate. Acum suntem gata să inițiem efectiv proiectul ca depozit de cod sursă.",
        "validare_task": "Executarea comenzii `git status` în directorul proiectului ar trebui să indice existența unui depozit Git (mesajul tipic „No commits yet” dacă nu există commit-uri). De asemenea, `git branch -m main` (dacă e cazul) asigură că ramura curentă se numește `main`. Verifică existența unui folder ascuns `.git/` în rădăcină, semn că repo-ul este inițializat.",
        "outcome_task": "Proiectul are un repository Git local inițializat, cu ramura principală setată la `main`, gata pentru commit-uri.",
        "restrictii_antihalucinatie": "Nu adăuga fișiere în stadiul de inițializare (doar creează repo-ul gol). Nu folosi un alt nume de branch principal decât cel convenit. Nu continua fără să existe depozitul local (comenzile Git trebuie să funcționeze)."
    },

    {
        "id_task": "F0.2.2",
        "denumire_task": "Creare repository remote și adăugare remote origin",
        "descriere_task": "Creează un repository remote pe platforma aleasă (de ex. GitHub, GitLab). Numește repository-ul, de exemplu, `Neanelu_Shopify` sau un nume relevant (precum 'manager-shopify'). Copiază URL-ul repository-ului nou creat (SSH sau HTTPS). În depozitul Git local, adaugă remote-ul folosind comanda `git remote add origin <URL>`. Verifică că remote-ul a fost adăugat corect (ex. `git remote -v` arată origin-ul setat).",
        "cale_implementare": "Platforma Git externă (GitHub) și local /Neanelu_Shopify",
        "contextul_anterior": "Repository-ul local este inițializat. Pentru colaborare și backup, avem nevoie de un repository remote.",
        "validare_task": "Pe platforma Git (ex. GitHub) verifică existența noului repository. Local, `git remote -v` ar trebui să listeze origin cu URL-ul corect. Nu apar erori la adăugarea remote-ului.",
        "outcome_task": "Repository-ul remote este pregătit și legat de repository-ul local sub numele de remote `origin`, permițând împingerea modificărilor local->remote.",
        "restrictii_antihalucinatie": "Nu publica fișierele locale încă (fără push la acest pas, doar setare remote). Nu utiliza alt nume decât `origin` pentru remote-ul principal (evităm confuzii). Asigură-te că adresa remote este corectă și accesibilă (autentificare configurată dacă e cazul) înainte de a continua."
    },

    {
        "id_task": "F0.2.3",
        "denumire_task": "Creare fișier .gitignore cu excluderi standard",
        "descriere_task": "În rădăcina proiectului, creează fișierul `.gitignore` care să listeze fișierele și directoarele ce nu trebuie urmărite de Git. Include tipic: `node_modules/`, `dist/` sau `build/` (output-urile de build), fișiere temporare sau de configurare locală (ex: `.env`, `.DS_Store`, `npm-debug.log`). Folosește un șablon standard pentru proiecte Node/React (poate fi generat de `gitignore.io` pentru Node, Windows, macOS, Linux etc., apoi adaptat). Asigură-te că intrările relevante pentru pnpm (ex. `pnpm-debug.log` dacă există) sunt incluse.",
        "cale_implementare": "/Neanelu_Shopify/.gitignore",
        "contextul_anterior": "Repository-ul Git este configurat. Înainte de a adăuga fișiere, definim excluderile pentru a evita versi onarea artefactelor sau a fișierelor sensibile.",
        "validare_task": "Deschide `.gitignore` și verifică prezența intrărilor esențiale (node_modules, fișiere build, log-uri, configurații locale). Rulează `git status` după adăugarea unor directoare ignorabile (dacă există) și confirmă că Git nu le listează pentru commit (semn că `.gitignore` funcționează).",
        "outcome_task": "Fișierul `.gitignore` este prezent și configurat corect, prevenind includerea în repository a fișierelor nedorite (dependințe, fișiere temporare, config locale etc.).",
        "restrictii_antihalucinatie": "Nu adăuga în `.gitignore` fișiere vitale proiectului. Nu lăsa neacoperite directoare standard (omisiuni ce ar duce la versi onarea fișierelor mari inutile). Nu continua fără ca `.gitignore` să fie creat și să includă cazurile uzuale."
    },

    {
        "id_task": "F0.2.4",
        "denumire_task": "Adăugare licență open-source (LICENSE, MIT)",
        "descriere_task": "Repo-ul este public; adaugă fișierul `LICENSE` cu textul standard MIT în rădăcina proiectului. Completează Year și Copyright cu datele proiectului. Scop: clarifică termenii de utilizare pentru colaboratori și utilizatori înainte să existe cod.",
        "cale_implementare": "/Neanelu_Shopify/LICENSE",
        "contextul_anterior": "Repo-ul este public și începe să prindă conținut; licența trebuie publicată înaintea codului sursă pentru a evita ambiguități legale.",
        "validare_task": "Verifică că fișierul `LICENSE` conține textul MIT integral (inclusiv year + holder) și corespunde șablonului GitHub. Confirmați printr-o revizie internă rapidă.",
        "outcome_task": "Licența MIT este publicată în repository, stabilind explicit termenii open-source.",
        "restrictii_antihalucinatie": "Nu modifica textul standard al MIT în afara completării year/holder. Nu omite fișierul LICENSE – este obligatoriu pentru repo public."
    },

    {
        "id_task": "F0.2.5",
        "denumire_task": "Creare fișier README.md cu descrierea proiectului",
        "descriere_task": "Creează un fișier `README.md` la rădăcina proiectului care conține o descriere succintă a aplicației Manager Shopify. Include scopul proiectului, tehnologiile principale și eventual instrucțiuni inițiale de rulare (pe scurt, ex: cum se instalează dependențele și se pornește mediul local). Acest README va fi vizibil pe platforma de cod (ex. GitHub) și va servi ca punct de intrare pentru oricine accesează repository-ul.",
        "cale_implementare": "/Neanelu_Shopify/README.md",
        "contextul_anterior": "Elementele esențiale (gitignore, licență) sunt pregătite. Adăugăm acum documentația de bază direct în repository, complementară wiki-ului intern detaliat.",
        "validare_task": "Deschide `README.md` și verifică formatul Markdown (titlu, secțiuni, liste, etc.). Asigură-te că descrierea este clară și conține cuvinte-cheie relevante (Shopify, volum mare de date, AI, etc.). Dacă platforma de git oferă previzualizare, verifică randarea corectă. Validarea se consideră reușită dacă informațiile din README sunt actuale și nu contrazic documentația internă detaliată.",
        "outcome_task": "Există un README.md vizibil în repository, oferind o vedere de ansamblu a proiectului și îndrumând cititorii către detalii suplimentare dacă este cazul.",
        "restrictii_antihalucinatie": "Nu copia text excesiv în README (trebuie să fie concis). Nu lăsa secțiuni din șablon necompletate (ex: „Installation” gol etc., dacă nu sunt relevante, elimină-le). Asigură-te că nu există discrepanțe între README și alte documente."
    },

    {
        "id_task": "F0.2.6",
        "denumire_task": "Inițializare configurație pnpm (creare package.json)",
        "descriere_task": "Inițializează proiectul ca pachet npm/pnpm. Rulează `pnpm init` în rădăcina proiectului pentru a genera un fișier `package.json` minimal. Completează prompt-urile cu informații relevante: numele pachetului (poate fi `neanelu_shopify` sau similar, toate literele mici), versiunea (0.1.0 inițial), descriere scurtă, entry point (nu este critic, poate fi `index.js` temporar), autor, licență (dacă a fost adăugat LICENSE, pnpm init ar putea prelua MIT automat, altfel specifică licența). Alternativ, folosește flagul (`--yes`) pentru a accepta implicit majoritatea și apoi editează manual fișierul. Asigură-te că `package.json` rezultat este valid JSON și conține câmpurile de bază.",
        "cale_implementare": "/Neanelu_Shopify/package.json",
        "contextul_anterior": "Repo-ul conține fișiere de configurare inițiale și documentație. Urmează să definim package-ul Node principal al monorepo-ului pentru a putea începe adăugarea de dependențe și workspace-uri.",
        "validare_task": "Deschide `package.json` generat și verifică: câmpul \"name\" este unic și nu are spații/litere mari, versiunea este prezentă, licența corespunde (de ex. MIT dacă ai licență MIT), autorul este completat corect etc. Rulează `pnpm install` (fără parametri) pentru a vedea că nu apar erori de sintaxă în fișier. Un `git status` ar trebui să arate `package.json` ca fișier nou pregătit de commit.",
        "outcome_task": "Fișierul `package.json` al proiectului este creat, conținând meta-informațiile de bază și pregătit pentru a fi completat cu setări suplimentare (workspaces, dependențe).",
        "restrictii_antihalucinatie": "Nu introduce dependențe externe încă în `package.json` (doar structura generală). Nu folosi un nume de pachet care ar putea exista deja public fără a verifica (evităm conflicte dacă nu e privat). Nu lăsa câmpuri importante necompletate dacă init-ul le-a omis (completează manual unde e nevoie)."
    },

    {
        "id_task": "F0.2.7",
        "denumire_task": "Configurarea câmpurilor custom în package.json (engines, private)",
        "descriere_task": "Editează fișierul `package.json` proaspăt creat pentru a adăuga configurațiile convenite anterior. În particular, adaugă secțiunea 'engines' cu versiunile minime **OBLIGATORII**: 'node': '>=24.0.0' și 'pnpm': '>=10.0.0'. De asemenea, setează 'private': true pentru monorepo (astfel încât acest pachet rădăcină să nu fie publicat accidental pe un registry npm). Verifică dacă mai sunt și alte câmpuri de adăugat sau ajustat (descriere, keywords) și actualizează-le dacă e necesar. Salvează modificările în `package.json`.",
        "cale_implementare": "/Neanelu_Shopify/package.json",
        "contextul_anterior": "Fișierul package.json a fost creat cu datele implicite. Conform planificării anterioare, trebuie acum să-l completăm cu constrângerile de versiune și setările de monorepo.",
        "validare_task": "Deschide `package.json` și confirmă că secțiunea 'engines' există și conține Node >=24 și pnpm >=10. Confirmă că 'private': true este prezent la rădăcină (la nivelul superior al JSON). Asigură-te că formatul JSON rămâne valid (virgulele și acoladele sunt corecte). Rulează `pnpm install` pentru a vedea dacă apare vreo eroare datorită engine-strict – aceasta ar fi de așteptat dacă versiunea pnpm nucorespunde, altfel nicio ieșire specială indică că sintaxa e ok.",
        "outcome_task": "Package.json-ul proiectului include acum restricțiile de versiuni Node>=24/pnpm>=10 și este marcat ca privat, conform convențiilor DevOps stabilite.",
        "restrictii_antihalucinatie": "NU folosi versiuni mai vechi (pnpm >=9) - proiectul necesită pnpm 10+. Nu uita să adaugi virgule la sfârșitul secțiunilor noi dacă nu sunt ultimele (menține JSON valid). Nu seta 'private': false din greșeală – pentru monorepo intern trebuie să fie true."
    },

    {
        "id_task": "F0.2.7.1",
        "denumire_task": "Creare fișier .env.example COMPLET pentru gestionarea secretelor - OBLIGATORIU",
        "descriere_task": "Creează fișierul `.env.example` la rădăcina proiectului care listează TOATE variabilele de mediu necesare conform DevOps_Plan_Implementare_Shopify_Enterprise.md, cu valori placeholder. Acest fișier SE COMITE în Git și servește ca șablon pentru `.env` (care NU se comite).\n\nConținut **COMPLET** obligatoriu:\n```\n# ============================================\n# DATABASE (PostgreSQL 18.1)\n# ============================================\nDATABASE_URL=postgresql://user:password@localhost:65010/neanelu_shopify\nDB_POOL_SIZE=10\n\n# ============================================\n# REDIS 8.4\n# ============================================\nREDIS_URL=redis://localhost:65011\n\n# ============================================\n# SHOPIFY API\n# ============================================\nSHOPIFY_API_KEY=your_api_key_here\nSHOPIFY_API_SECRET=your_api_secret_here\nSCOPES=read_products,write_products,read_orders\n\n# ============================================\n# BULLMQ PRO (registry privat + runtime)\n# ============================================\nNPM_TASKFORCESH_TOKEN=your_bullmq_pro_npm_token\nBULLMQ_PRO_TOKEN=your_bullmq_pro_license_token\n\n# ============================================\n# OPENAI / AI ENGINE\n# ============================================\nOPENAI_API_KEY=your_openai_api_key\n\n# ============================================\n# SECURITY & ENCRYPTION\n# ============================================\nENCRYPTION_KEY_256=your_32_byte_hex_key_here\n\n# ============================================\n# APPLICATION\n# ============================================\nAPP_HOST=https://localhost:65000\nNODE_ENV=development\nLOG_LEVEL=debug\n\n# ============================================\n# OBSERVABILITY (OpenTelemetry)\n# ============================================\nOTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:65022\nOTEL_SERVICE_NAME=neanelu-shopify\n```\n\nDe asemenea, confirmă că `.env` este în `.gitignore`.\n\n**Notă pentru staging/prod:** Aceste valori vor fi injectate din OpenBAO (self-hosted, Docker) prin mecanismul de deploy (OpenBAO Agent template → env-file pe host → docker compose --env-file). CI doar declanșează deploy-ul; nu ținem secrete în repo/imagini.",
        "cale_implementare": "/Neanelu_Shopify/.env.example",
        "contextul_anterior": "Fișierul package.json este configurat. CONFORM standardelor DevOps din documentația proiectului, .env.example TREBUIE să existe înainte de primul commit pentru a permite onboarding reproductibil și CI funcțional.",
        "validare_task": "Verifică existența `.env.example` și că include TOATE variabilele obligatorii: DATABASE_URL, REDIS_URL, SHOPIFY_*, NPM_TASKFORCESH_TOKEN, BULLMQ_PRO_TOKEN, OPENAI_API_KEY, ENCRYPTION_KEY_256, APP_HOST, OTEL_EXPORTER_OTLP_ENDPOINT. Confirmă că `.env` apare în `.gitignore`.",
        "outcome_task": "Fișierul .env.example este COMPLET conform standardelor DevOps, oferind documentație vie a tuturor secretelor necesare pentru toate mediile (dev/staging/prod).",
        "restrictii_antihalucinatie": "NU include valori reale de secrete în .env.example - doar placeholdere. NU OMITE nicio variabilă din lista de mai sus. VERIFICĂ că am inclus ENCRYPTION_KEY_256, APP_HOST și OTEL_EXPORTER_OTLP_ENDPOINT care sunt obligatorii conform documentației."
    },

    {
        "id_task": "F0.2.8",
        "denumire_task": "Realizarea primului commit (Initial commit)",
        "descriere_task": "Adaugă toate fișierele create (utilizează `git add .` pentru a include toate noile fișiere: .gitignore, LICENSE, README.md, package.json etc.). Verifică cu `git status` că toate apar în staging. Efectuează primul commit cu un mesaj sugestiv (ex: `git commit -m 'Initial commit: project structure and configs'`). Acest commit va include atât configurările de bază, cât și documentația adăugată, marcând startul istoriei versionării proiectului.",
        "cale_implementare": "Repository Git local (/Neanelu_Shopify)",
        "contextul_anterior": "Toate fișierele inițiale au fost create și sunt pregătite. Este momentul să le salvăm în istoricul Git.",
        "validare_task": "După `git commit`, rulează din nou `git status` și confirmă că mesajul indică 'nothing to commit, working tree clean'. Verifică log-ul (`git log --oneline -1`) ca să vezi commit-ul proaspăt cu mesajul corect. Asigură-te că toate fișierele relevante apar în lista de fișiere comise (`git show --name-only HEAD`).",
        "outcome_task": "Commit-ul inițial este realizat cu succes, conținând fișierele de bază ale proiectului. Istoricul Git al proiectului pornește de la acest commit.",
        "restrictii_antihalucinatie": "Nu omite niciun fișier important din commit (verifică dublu că `.gitignore`, `package.json` etc. sunt incluși). Nu folosi un mesaj de commit generic sau gol – trebuie să fie clar ce introduce acest commit. Nu continua înainte de a confirma că commit-ul există în istoric."
    },

    {
        "id_task": "F0.2.9",
        "denumire_task": "Transmiterea codului inițial pe repository-ul remote (git push)",
        "descriere_task": "Efectuează comanda `git push -u origin main` pentru a trimite commit-ul `main` (cel inițial) către repository-ul remote (GitHub). Dacă autentificarea este necesară, furnizează token-ul sau cheile SSH potrivite. După push, verifică pe platforma remote că fișierele apar (README.md, package.json, .env.example, .npmrc etc.) și că commit-ul este vizibil. **IMPORTANT:** Branch-ul `main` trebuie să existe pe remote înainte de a configura branch protection.",
        "cale_implementare": "Repository remote (origin) pe platforma Git",
        "contextul_anterior": "Commit-ul inițial există local. Trebuie publicat pe remote PRIMUL, apoi se pot activa protecțiile de branch (GitHub nu permite protecții pe branch-uri inexistente).",
        "validare_task": "După rularea `git push`, verifică pe GitHub interfața repository-ului: fișierele se văd, istoricul arată commit-ul 'Initial commit'. Alternativ, rulează `git fetch origin && git log origin/main --oneline` pentru a vedea că remote-ul are commit-ul așteptat.",
        "outcome_task": "Codul inițial al proiectului este versionat atât local, cât și pe remote. Branch-ul `main` există pe GitHub și poate primi protecții.",
        "restrictii_antihalucinatie": "NU omite push-ul - branch protection NU poate fi configurat pe un branch inexistent. NU face push către alt branch sau alt remote din greșeală."
    },

    {
        "id_task": "F0.2.10",
        "denumire_task": "Configurare branch protection pe main (DUPĂ push)",
        "descriere_task": "ACUM că branch-ul `main` există pe GitHub, accesează Settings → Branches → Branch protection rules și activează protecția:\n- Require pull request reviews before merging (min 1 reviewer)\n- Require status checks to pass before merging (selectează job-urile CI când vor exista)\n- Require branches to be up to date before merging\n- Do not allow bypassing the above settings\n- Restrict who can push to matching branches (doar bots/admins dacă e cazul)\n\n**Notă:** Required status checks pot fi configurate complet DOAR după ce CI-ul există (F1.4). Activează deocamdată ce e posibil.",
        "cale_implementare": "Interfața platformei Git (ex. GitHub Settings -> Branches)",
        "contextul_anterior": "Branch-ul main există pe remote după push-ul anterior. ACUM se pot aplica regulile de protecție.",
        "validare_task": "Verifică în interfața GitHub că ramura `main` apare ca protejată (badge 'Protected'). Încearcă un push direct pe main (trebuie să eșueze cu 'protected branch').",
        "outcome_task": "Ramura `main` este protejată conform regulilor de guvernanță, prevenind actualizări necontrolate.",
        "restrictii_antihalucinatie": "NU dezactiva protecțiile. Required status checks pot rămâne incomplete până la F1.4 când CI-ul există."
    },

    {
        "id_task": "F0.2.11",
        "denumire_task": "Activare GitHub Security Features (secret scanning, Dependabot)",
        "descriere_task": "Accesează Settings → Code security and analysis și activează:\n1. **Secret scanning:** Detectează automat secrete comise accidental (API keys, tokens)\n2. **Push protection:** Blochează push-urile cu secrete detectate\n3. **Dependabot alerts:** Notificări pentru vulnerabilități în dependențe\n4. **Dependabot security updates:** PR-uri automate pentru patch-uri de securitate\n5. (Opțional) **Dependabot version updates:** Crează `.github/dependabot.yml` pentru update-uri regulate de dependențe\n\nAceste setări sunt MINIME pentru un proiect enterprise open-source.",
        "cale_implementare": "GitHub Settings -> Code security and analysis + .github/dependabot.yml",
        "contextul_anterior": "Branch-ul este protejat. Urmează să activăm layer-ul de securitate la nivel de supply chain.",
        "validare_task": "Verifică în Settings că secret scanning, push protection și Dependabot alerts sunt ON (butonul verde). Dacă ai creat dependabot.yml, verifică că apare în repo și nu are erori de sintaxă.",
        "outcome_task": "Proiectul are protecție automată împotriva secretelor comise accidental și alertare pentru vulnerabilități.",
        "restrictii_antihalucinatie": "NU dezactiva secret scanning pentru un repo public. NU ignora alertele Dependabot – trebuie procesate."
    },

    {
        "id_task": "F0.2.12",
        "denumire_task": "Creare fișiere governance: CODEOWNERS, PR template, SECURITY.md",
        "descriere_task": "Crează următoarele fișiere pentru governance standard:\n\n1. **`.github/CODEOWNERS`** - definește cine review-uiește ce:\n```\n* @owner-username\n/packages/database/ @db-team\n/apps/web-admin/ @frontend-team\n```\n\n2. **`.github/PULL_REQUEST_TEMPLATE.md`** - template pentru PR-uri:\n```markdown\n## Description\n[Describe changes]\n\n## Type of change\n- [ ] Bug fix\n- [ ] New feature\n- [ ] Breaking change\n\n## Checklist\n- [ ] Tests pass locally\n- [ ] Docs updated if needed\n```\n\n3. **`SECURITY.md`** - policy pentru raportarea vulnerabilităților:\n```markdown\n# Security Policy\n## Reporting a Vulnerability\nEmail: security@example.com\n```",
        "cale_implementare": "/.github/CODEOWNERS, /.github/PULL_REQUEST_TEMPLATE.md, /SECURITY.md",
        "contextul_anterior": "Branch-ul și securitatea de bază sunt setate. Adăugăm governance la nivel de workflow.",
        "validare_task": "Verifică că CODEOWNERS e parsat corect de GitHub (Settings -> Branches -> CODEOWNERS errors). Deschide un PR test și confirmă că template-ul apare automat.",
        "outcome_task": "Proiectul are governance standard: revieweri auto-asignați, template PR consistent, policy de securitate publică.",
        "restrictii_antihalucinatie": "NU lăsa CODEOWNERS cu usernames invalide. SECURITY.md trebuie să conțină un contact real."
    },

    {
        "id_task": "F0.2.13",
        "denumire_task": "Stabilire convenții Conventional Commits și branch naming",
        "descriere_task": "Documentează și implementează convențiile de commit și branch:\n\n**Conventional Commits** (obligatoriu):\n- `feat:` - feature nou\n- `fix:` - bug fix\n- `docs:` - documentație\n- `chore:` - mentenanță\n- `refactor:` - refactorizare fără schimbare funcțională\n- `test:` - teste\n- `ci:` - CI/CD changes\n\n**Branch naming:**\n- `feat/<short-description>` - features\n- `fix/<issue-id>-<description>` - bugfixes\n- `chore/<description>` - mentenanță\n\nAdăugă aceste convenții în README.md sau CONTRIBUTING.md. Opțional: instalează commitlint în F1.3 pentru validare automată.",
        "cale_implementare": "/README.md sau /CONTRIBUTING.md",
        "contextul_anterior": "Governance de bază e setat. Stabilím acum regulile de colaborare.",
        "validare_task": "Verifică că convențiile sunt documentate Public și accesibile. Echipa confirmă înțelegerea regulilor.",
        "outcome_task": "Există un standard clar pentru mesaje de commit și naming de branch-uri, facilitând automatizarea changelog-ului și review-ul.",
        "restrictii_antihalucinatie": "NU forța Conventional Commits fără tooling de validare (commitlint). Deocamdată e doar convenție documentată."
    }
    ```

## Faza F1: Bootstrapping și Configurare Mediu Local (Săptămâna 1)

Durată: Săptămâna 1
Obiectiv: Configurarea mediului local de dezvoltare într-un mod reproductibil și standardizat (trecând de la „merge pe calculatorul meu” la „merge în container pentru toată lumea”).

### F1.1: Inițializare Monorepo și configurare pnpm

    ```JSON
    {
        "id_task": "F1.1.1",
        "denumire_task": "Creare directoare de bază pentru monorepo (`apps/` și `packages/`)",
        "descriere_task": "În rădăcina proiectului, creează două directoare goale: `apps/` (va conține aplicațiile executabile) și `packages/` (va conține bibliotecile/pachetele partajate). Aceste directoare vor organiza codul conform planului stabilit (fiecare subdirector de sub `apps` va fi o aplicație independentă, iar fiecare subdirector de sub `packages` va fi un modul reutilizabil).",
        "cale_implementare": "/Neanelu_Shopify (rădăcina proiectului)",
        "contextul_anterior": "Repository-ul este inițializat cu configurările de bază. Următorul pas este să creăm structura monorepo pentru a găzdui codul aplicației.",
        "validare_task": "Verifică în sistemul de fișiere că directoarele `apps` și `packages` au fost create la rădăcina proiectului (`ls` sau vizualizare în IDE). Ambele directoare trebuie să fie versionate acum (apărând la `git status` ca neînregistrate până la commit).",
        "outcome_task": "Structura de directoare monorepo este începută, având directoarele rădăcină `apps/` și `packages/` disponibile pentru a adăuga modulele proiectului.",
        "restrictii_antihalucinatie": "Nu crea alte directoare în afară de cele specificate. Nu muta sau redenumi aceste directoare ulterior fără actualizarea configurației pnpm. Asigură-te că aceste foldere sunt la nivelul rădăcinii repository-ului."
    },

    {
        "id_task": "F1.1.2",
        "denumire_task": "Configurare pnpm workspaces (fișier pnpm-workspace.yaml)",
        "descriere_task": "Creează fișierul `pnpm-workspace.yaml` în rădăcina proiectului. În interiorul lui, definește globs-urile de workspaces astfel încât pnpm să recunoască toate sub-proiectele. Exemplu de conținut:\n```yaml\npackages:\n  - 'apps/*'\n  - 'packages/*'\n```\nAcest fișier asigură că pnpm tratează toate directoarele din `apps` și `packages` drept părți ale monorepo-ului, permițând instalarea interdependentă a modulelor.",
        "cale_implementare": "/Neanelu_Shopify/pnpm-workspace.yaml",
        "contextul_anterior": "Directoarele monorepo au fost create. Pentru ca pnpm să le gestioneze corect ca workspace-uri multiple, trebuie să furnizăm configurația corespunzătoare.",
        "validare_task": "Deschide `pnpm-workspace.yaml` și verifică sintaxa YAML (indentare corectă, fără erori). Rulează `pnpm list -r` (recursive list) în rădăcina proiectului; chiar dacă nu sunt instalate pachete încă, comanda nu ar trebui să dea erori și ar trebui să afișeze folderele goale ca workspaces recunoscute.",
        "outcome_task": "Fișierul de configurare a workspace-urilor pnpm este prezent și include toate directoarele relevante (`apps/*` și `packages/*`), pregătind terenul pentru instalarea dependențelor și referințelor interne.",
        "restrictii_antihalucinatie": "Nu scrie căi greșite în glob-uri (respectă structura creată). Nu omite includerea unuia dintre directoare (`apps` sau `packages`). Nu continua fără acest fișier – altfel pnpm nu va trata monorepo-ul corect."
    },
    {
        "id_task": "F1.1.3",
        "denumire_task": "Inițializare aplicație front-end (`apps/web-admin`)",
        "descriere_task": "Creează un subdirector `web-admin` în interiorul folderului `apps/`. Acesta va conține aplicația front-end (React) integrată în Shopify. În terminal, navighează în `apps/web-admin` și rulează `pnpm init -y` pentru a genera un `package.json` pentru această aplicație. Editează `package.json` rezultat pentru a stabili un nume de pachet unic, de forma `\"name\": \"@app/web-admin\"`, versiune `1.0.0` (sau `0.1.0` inițial), și asigură-te că are câmpul \"private\" moștenit din root (workspace). Vei putea adăuga ulterior dependențele și scripturile specifice acestei aplicații.",
        "cale_implementare": "/Neanelu_Shopify/apps/web-admin/package.json",
        "contextul_anterior": "Workspace-urile pnpm sunt definite. Începem popularea directorului `apps` cu prima aplicație (frontend-ul admin).",
        "validare_task": "Verifică existența fișierului `apps/web-admin/package.json`. În interiorul lui, confirmă că `name` este `@app/web-admin` și că celelalte câmpuri standard (version, main, license etc.) sunt prezente. Rulează `pnpm install` la rădăcina monorepo-ului și observă că pnpm recunoaște `@app/web-admin` ca workspace (apare în listă la instalare, chiar dacă nu are dependențe). Asigură-te că nu apar erori. ",
        "outcome_task": "Aplicația front-end `web-admin` este inițializată ca un pachet intern al monorepo-ului (scoped under `@app`), pregătită să primească codul sursă al interfeței React.",
        "restrictii_antihalucinatie": "Nu uita să prefixezi numele pachetului cu scope-ul `@app` pentru a evita coliziuni cu pachete publice. Nu adăuga încă dependențe în acest pachet (doar inițializare). Nu modifica structura directorului (package.json trebuie să rămână în `apps/web-admin`)."
    },

    {
        "id_task": "F1.1.4",
        "denumire_task": "Inițializare aplicație back-end (`apps/backend-worker`)",
        "descriere_task": "Creează subdirectorul `backend-worker` sub `apps/`. Acesta va conține serviciul back-end Node.js (API + worker asincron). Rulează `pnpm init -y` în `apps/backend-worker` pentru a crea un `package.json`. Editează fișierul pentru a seta `\"name\": \"@app/backend-worker\"` și versiunea inițială. Acest pachet va fi principalul server al aplicației, integrând în viitor dependențele locale (database, queue, etc.).",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/package.json",
        "contextul_anterior": "Aplicația front-end a fost creată. Acum creăm aplicația back-end corespunzătoare, care va procesa logica de server și evenimentele asincrone.",
        "validare_task": "Asigură-te că `apps/backend-worker/package.json` există și conține `name: \"@app/backend-worker\"`. Rulează `pnpm install` la rădăcină din nou, confirmând că pnpm listează acum și `@app/backend-worker` ca workspace. `pnpm m ls` (monorepo list) ar trebui să includă ambele pachete create în `apps`. Nicio eroare nu trebuie să apară.",
        "outcome_task": "`backend-worker` este inițializat ca pachet workspace, reprezentând serviciul Node.js al aplicației, pregătit pentru a fi dezvoltat cu dependențele sale specifice.",
        "restrictii_antihalucinatie": "Nu confunda rolul pachetului backend-worker – acesta va servi și API-ul HTTP, și worker-ul de cozi. Nu renumi pachetul fără actualizarea corespunzătoare a referințelor. Nu continua fără a vedea pachetele din `apps/` reflectate în output-ul pnpm (semn că totul e configurat corect)."
    },

    {
        "id_task": "F1.1.5",
        "denumire_task": "Creare module partajate în directorul `packages/` (SET COMPLET)",
        "descriere_task": "Conform planului de arhitectură și blueprint-ului din Docs, crează subdirectoare pentru TOATE modulele interne în `packages/`:\n\n**Pachete obligatorii (7 total):**\n1. `database` - acces PostgreSQL cu Drizzle ORM\n2. `shopify-client` - wrapper API Shopify\n3. `queue-manager` - BullMQ Pro cozi\n4. `ai-engine` - integrare OpenAI\n5. `config` (**NOU**) - parsare și validare config/env centralizată\n6. `types` (**NOU**) - tipuri TypeScript partajate cross-workspace\n7. `logger` (**NOU**) - logging structurat + OTel wrappers\n\nAceste directoare rămân inițial goale. Fără `config`, `types` și `logger`, ajungi rapid la config duplicat și drift între apps.",
        "cale_implementare": "/Neanelu_Shopify/packages/ (subdirectoare: database/, shopify-client/, queue-manager/, ai-engine/, config/, types/, logger/)",
        "contextul_anterior": "Aplicațiile au fost create. Urmează definirea modulelor comune astfel încât aplicațiile să poată comunica cu resursele externe și logica partajată prin pachete dedicate.",
        "validare_task": "Verifică existența celor 7 directoare sub `packages/`. Un `ls packages` arată folderele corecte: database, shopify-client, queue-manager, ai-engine, config, types, logger.",
        "outcome_task": "Directoarele pentru TOATE modulele partajate sunt create, incluzând pachetele de infrastructură (config, types, logger) care previn duplicarea și drift-ul.",
        "restrictii_antihalucinatie": "NU omite pachetele config, types și logger - sunt esențiale pentru scalabilitate. Denumirile directoarelor trebuie să fie exact cele stabilite."
    },

    {
        "id_task": "F1.1.6",
        "denumire_task": "Inițializare TOATE pachetele interne (7 pachete)",
        "descriere_task": "Pentru fiecare director din `packages/` creat anterior, inițializează un `package.json` astfel încât pnpm să le recunoască drept pachete. Navighează pe rând și rulează `pnpm init -y`. Apoi editează fiecare fișier `package.json` pentru a atribui un nume cu scope:\n\n- `@app/database`\n- `@app/shopify-client`\n- `@app/queue-manager`\n- `@app/ai-engine`\n- `@app/config` (**NOU**)\n- `@app/types` (**NOU**)\n- `@app/logger` (**NOU**)\n\nToate cu versiuni 0.1.0. Acest lucru permite aplicațiilor să depindă de aceste pachete prin referințe locale.",
        "cale_implementare": "/Neanelu_Shopify/packages/*/package.json",
        "contextul_anterior": "Structura folderelor de pachete este pregătită. Trebuie acum declarate oficial ca pachete interne, cu nume și versiuni, pentru a putea fi legate ca dependențe.",
        "validare_task": "Pentru fiecare modul, verifică `package.json` creat. Rulează `pnpm install` în rădăcină; pnpm ar trebui să indice acum toate workspace-urile: 2 aplicații + 7 pachete = 9 total.",
        "outcome_task": "Toate cele 7 module interne sunt inițializate ca pachete private ale monorepo-ului.",
        "restrictii_antihalucinatie": "NU uita pachetele config, types și logger. Nu continua dacă pnpm nu recunoaște toate cele 9 workspaces (2 apps + 7 packages)."
    },

    {
        "id_task": "F1.1.6.1",
        "denumire_task": "Bootstrap TypeScript: tsconfig.base.json, configurații per workspace, ESM standard",
        "descriere_task": "**OBLIGATORIU conform Stack Tehnologic:** Instalează TypeScript la root și configurează:\n\n1. **Instalare:** `pnpm add -Dw typescript @types/node`\n\n2. **Creare `tsconfig.base.json` la root:**\n```json\n{\n  \"compilerOptions\": {\n    \"target\": \"ESNext\",\n    \"module\": \"NodeNext\",\n    \"moduleResolution\": \"NodeNext\",\n    \"strict\": true,\n    \"esModuleInterop\": true,\n    \"skipLibCheck\": true,\n    \"declaration\": true,\n    \"declarationMap\": true,\n    \"sourceMap\": true,\n    \"outDir\": \"dist\",\n    \"rootDir\": \"src\",\n    \"resolveJsonModule\": true,\n    \"isolatedModules\": true,\n    \"baseUrl\": \".\",\n    \"paths\": {\n      \"@app/*\": [\"packages/*/src\"]\n    }\n  }\n}\n```\n\n3. **Creare `tsconfig.json` în fiecare workspace** care extinde tsconfig.base.json:\n```json\n{\n  \"extends\": \"../../tsconfig.base.json\",\n  \"compilerOptions\": {\n    \"outDir\": \"./dist\",\n    \"rootDir\": \"./src\"\n  },\n  \"include\": [\"src/**/*\"],\n  \"exclude\": [\"node_modules\", \"dist\"]\n}\n```\n\n4. **Adaugă scripturi în root package.json (cu --if-present pentru repo skeleton):**\n- `typecheck`: `pnpm -r --if-present run typecheck`\n- `build`: `pnpm -r --if-present run build`\n\n5. **DECIZIE EXPLICITĂ build strategy:**\n- Backend (apps/backend-worker): folosește `tsc` (nativ Node.js, fără bundler)\n- Frontend (apps/web-admin): folosește `vite build` (integrat cu React Router 7)\n- Packages: folosesc `tsc` pentru tipuri + declarații",
        "cale_implementare": "/Neanelu_Shopify/tsconfig.base.json + /Neanelu_Shopify/*/tsconfig.json",
        "contextul_anterior": "Pachetele sunt inițializate. CONFORM Docs (Stack Tehnologic Complet), TypeScript trebuie configurat ÎNAINTE de hooks/CI pentru a permite typecheck în pre-commit și CI.",
        "validare_task": "Verifică existența `tsconfig.base.json` la root. În fiecare workspace, verifică `tsconfig.json` care extinde base. Rulează `pnpm -w exec tsc --noEmit` la root - nu trebuie să dea erori de config (deși nu există încă cod sursă).",
        "outcome_task": "TypeScript este configurat cross-workspace cu ESM standard, path aliases, și strategie de build clară pentru backend vs frontend.",
        "restrictii_antihalucinatie": "NU sări peste acest pas - typecheck în F1.3/F1.4 va eșua fără TypeScript configurat. NU folosi CommonJS - proiectul este ESM-only (NodeNext). NU instala tsc global - folosește versiunea locală din workspace."
    },

    {
        "id_task": "F1.1.6.2",
        "denumire_task": "ESM Contract complet: type:module + exports + strategia de output",
        "descriere_task": "**OBLIGATORIU pentru a evita probleme ESM/CJS în runtime și Docker/CI:**\n\n1. **Adaugă `\"type\": \"module\"` în fiecare package.json:**\n   - Root `/package.json`\n   - `apps/web-admin/package.json`\n   - `apps/backend-worker/package.json`\n   - Toate pachetele din `packages/*/package.json`\n\n2. **Configurează exports în fiecare pachet shared:**\n```json\n{\n  \"name\": \"@app/database\",\n  \"type\": \"module\",\n  \"main\": \"./dist/index.js\",\n  \"types\": \"./dist/index.d.ts\",\n  \"exports\": {\n    \".\": {\n      \"types\": \"./dist/index.d.ts\",\n      \"import\": \"./dist/index.js\"\n    }\n  },\n  \"files\": [\"dist\"]\n}\n```\n\n3. **Convenții ESM obligatorii:**\n   - Toate importurile folosesc extensii explicite (`.js`) sau path aliases\n   - Nu se folosește `require()` - doar `import`\n   - `__dirname` și `__filename` nu sunt disponibile - folosește `import.meta.url`\n\n4. **Crează `.editorconfig` la root pentru consistență cross-OS:**\n```\nroot = true\n\n[*]\nindent_style = space\nindent_size = 2\nend_of_line = lf\ncharset = utf-8\ntrim_trailing_whitespace = true\ninsert_final_newline = true\n\n[*.md]\ntrim_trailing_whitespace = false\n```\n\n5. **Crează `.gitattributes` pentru line endings (glob-uri simple, compatibile):**\n```\n* text=auto eol=lf\n*.cmd text eol=crlf\n*.bat text eol=crlf\n```",
        "cale_implementare": "Toate package.json + /.editorconfig + /.gitattributes",
        "contextul_anterior": "TypeScript este configurat cu NodeNext (ESM). Fără `type: module`, Node.js va trata fișierele .js ca CommonJS și va apărea eroarea 'Cannot use import statement outside a module'.",
        "validare_task": "Verifică că TOATE package.json au `\"type\": \"module\"`. Verifică că pachetele shared au `exports` configurat. Verifică existența `.editorconfig` și `.gitattributes`. Testează: creează un fișier `test.js` cu `import x from 'y'` și rulează `node test.js` - nu trebuie să dea 'SyntaxError: Cannot use import'.",
        "outcome_task": "Proiectul este 100% ESM-only, cu configurație consistentă pentru build output, exports, și line endings cross-OS.",
        "restrictii_antihalucinatie": "NU omite `type: module` din niciun package.json - altfel runtime-ul va eșua. NU folosi require() nicăieri în cod. VERIFICĂ că .editorconfig și .gitattributes sunt comise pentru a evita diff-uri inutile pe multi-OS."
    },

    {
        "id_task": "F1.1.7",
        "denumire_task": "Configurarea scripturilor globale în root package.json",
        "descriere_task": "Actualizează fișierul de la rădăcina proiectului `package.json` pentru a include scripturi utile ce orchestrează monorepo-ul. De exemplu, adaugă:\n- **dev**: care să pornească în paralel aplicațiile (ex: folosind `pnpm -r run dev` sau un utilitar precum `concurrently` pentru a rula front-end-ul și back-end-ul simultan în dezvoltare).\n- **build**: pentru a construi toate pachetele/aplicațiile (ex: `pnpm -r run build`).\n- **lint**: pentru a rula linters global (ex: `eslint .` pe tot repo-ul) și **format**: pentru formatare (ex: `prettier --write .`).\n- **test**: (opțional) un script care va rula testele din toate sub-pachetele (ex: `pnpm -r run test`).\nInserează aceste intrări sub cheia 'scripts' a package.json root.",
        "cale_implementare": "/Neanelu_Shopify/package.json",
        "contextul_anterior": "Pachetele și aplicațiile monorepo sunt definite. Putem configura acum scripturile la nivel de repo pentru a facilita comandarea tuturor simultan.",
        "validare_task": "Deschide `package.json` de la root și confirmă existența noilor scripturi. Rulează `pnpm run dev` la rădăcină (deși sub-scripturile locale nu sunt încă implementate, nu ar trebui să dea erori de sintaxă; eventual va raporta că nu găsește scriptul 'dev' în sub-pachete, ceea ce e normal până definim acele scripturi mai târziu). Asigură-te că sintaxa JSON este validă după adăugare (virgulele puse corect).",
        "outcome_task": "Root-ul monorepo are acum scripturi convenționale definite, pregătind terenul pentru rularea unificată a aplicațiilor (development, build, test, lint etc.).",
        "restrictii_antihalucinatie": "Nu lansa încă efectiv procesele (front/back) prin `pnpm run dev` – momentan definim doar scripturile. Nu introduce comenzi concrete care nu vor funcționa (dacă aplicațiile nu au script 'dev' încă, știm că această comandă va da warning; e acceptabil temporar)."
    },

    {
        "id_task": "F1.1.8",
        "denumire_task": "Instalare inițială și generare lockfile pnpm",
        "descriere_task": "Rulează comanda generală `pnpm install` în directorul rădăcină. Chiar dacă momentan nu există dependențe externe, această comandă va genera fișierul `pnpm-lock.yaml` și va crea structura de directoare `node_modules` la rădăcină, incluzând legături către modulele interne (workspaces). Practic, pnpm va stabili symlink-urile între pachetele noastre (de exemplu, `node_modules/@app/database` va pointa către `packages/database`).",
        "cale_implementare": "/Neanelu_Shopify (rădăcina monorepo)",
        "contextul_anterior": "Am definit toate pachetele și aplicațiile, dar nu am rulat încă vreo instalare globală. Acum lăsăm pnpm să stabilească metadata de interdependență.",
        "validare_task": "După execuția `pnpm install`, verifică existența fișierului `pnpm-lock.yaml` la root (ar trebui să apară). Inspectează structura `node_modules/.pnpm/` și `node_modules/@app` – ar trebui să existe intrări corespunzătoare fiecărui workspace intern (chiar dacă nu conțin cod propriu încă). Asigură-te că nu apar erori sau warning-uri în output-ul comenzii (în mod ideal, pnpm raportează doar că nu are nimic de instalat, dar a creat lockfile).",
        "outcome_task": "Monorepo-ul are un fișier lock (pnpm-lock.yaml) și folderul node_modules configurat, reflectând starea inițială a workspace-urilor. Dependențele interne sunt corect legate prin symlink, pregătite pentru a fi consumate.",
        "restrictii_antihalucinatie": "Nu adăuga dependențe externe în acest moment. Nu edita manual fișierul lock generat. Nu ignora eventualele mesaje de eroare ale pnpm – dacă apar, ele trebuie rezolvate (de ex., nume duplicat de pachet, versiuni conflict)."
    },

    {
        "id_task": "F1.1.9",
        "denumire_task": "Versionare schimbări (commit structura monorepo)",
        "descriere_task": "Adaugă noile fișiere și directoare la controlul versiunilor Git. Rulează `git add apps/ packages/ pnpm-workspace.yaml pnpm-lock.yaml` (și eventual update la package.json root) pentru a stage-ui tot. Efectuează un commit cu un mesaj relevant, de exemplu `git commit -m 'Setup monorepo structure: added workspaces and base packages'`. Acest commit va include atât structura de foldere creată, cât și fișierele de configurare aferente (workspace, lockfile etc.).",
        "cale_implementare": "Repository Git local (/Neanelu_Shopify)",
        "contextul_anterior": "Structura monorepo a fost implementată. Înainte de a continua cu alte configurări, e indicat să salvăm starea de lucru.",
        "validare_task": "Execută `git status` pentru a verifica că toate fișierele relevante sunt în staging. După commit, rulează `git log -1` și verifică că mesajul de commit este cel dorit și că include modificările (listează fișierele adăugate). De asemenea, poți verifica pe platforma remote (prin `git push` după commit, dacă dorești sincronizare imediată) că structura apare online.",
        "outcome_task": "Commit-ul de configurare a monorepo-ului este înregistrat în istoricul Git, astfel încât modificările de structură devin parte a liniei de bază a proiectului.",
        "restrictii_antihalucinatie": "Nu uita să adaugi toate fișierele relevante (inclusiv pnpm-lock.yaml, pe care nu trebuie să-l ignorăm). Nu folosi un mesaj generic – trebuie să exprime clar ce aduce commit-ul. Dacă repository-ul este remote, nu uita să împingi commit-ul (dar push-ul efectiv poate fi făcut la sfârșitul zilei, în funcție de flux)."
    },

    {
        "id_task": "F1.1.9.1",
        "denumire_task": "Validare .npmrc și registry @taskforcesh (smoke install BullMQ Pro)",
        "descriere_task": "**OBLIGATORIU pentru a evita blocaje în F4:** Verifică că registry-ul privat BullMQ Pro funcționează ÎNAINTE de a continua.\n\n1. **Verifică .npmrc configurat corect** (din F0.1.5):\n   - `@taskforcesh:registry=https://npm.taskforce.sh/`\n   - `//npm.taskforce.sh/:_authToken=${NPM_TASKFORCESH_TOKEN}`\n   - `always-auth=true`\n\n2. **Setează token-ul local** (NU în repo):\n   ```bash\n   export NPM_TASKFORCESH_TOKEN=\"your_actual_token_here\"\n   ```\n\n3. **Smoke install test (EXCLUSIV pnpm):**\n   ```bash\n   pnpm add @taskforcesh/bullmq-pro -D --filter @app/queue-manager --dry-run\n   ```\n   Dacă afișează pachetul fără eroare, registry-ul funcționează.\n\n4. **Alternativ, verifică versiunea cu pnpm:**\n   ```bash\n   pnpm view @taskforcesh/bullmq-pro version\n   ```\n\n**IMPORTANT:** Nu instala încă BullMQ Pro (doar verifică accesul). Instalarea reală vine în F4.",
        "cale_implementare": "/.npmrc + variabilă de mediu NPM_TASKFORCESH_TOKEN",
        "contextul_anterior": "F0 a configurat .npmrc, dar fără validare. Descoperirea unui blocaj la registry în F4 înseamnă timp pierdut.",
        "validare_task": "Comanda `pnpm add @taskforcesh/bullmq-pro --dry-run` returnează succes cu versiunea pachetului, NU eroare 401/403. Token-ul NU apare în .npmrc comis (doar ${NPM_TASKFORCESH_TOKEN}).",
        "outcome_task": "Registry-ul privat BullMQ Pro este validat și funcțional. Echipa știe că onboarding-ul necesită setarea token-ului local.",
        "restrictii_antihalucinatie": "NU comite token-ul real. NU instala încă BullMQ Pro - doar verifică accesul. NU ignora erori 401/403 - rezolvă-le ACUM, nu în F4."
    },

    {
        "id_task": "F1.1.9.2",
        "denumire_task": "CI Contract Scripts: lint, typecheck, test cu comportament determinist pe skeleton",
        "descriere_task": "**OBLIGATORIU pentru ca CI să funcționeze în F1.4:** Definește scripturile CI la root care funcționează chiar pe repo 'skeleton' (fără cod sursă).\n\n**Adaugă/actualizează în root package.json (cu --if-present pentru monorepo-safe):**\n```json\n{\n  \"scripts\": {\n    \"lint\": \"eslint . --ext .ts,.tsx --max-warnings 0\",\n    \"lint:fix\": \"eslint . --ext .ts,.tsx --fix\",\n    \"typecheck\": \"pnpm -r --if-present run typecheck\",\n    \"test\": \"pnpm -r --if-present run test\",\n    \"test:backend\": \"pnpm --filter @app/backend-worker --if-present run test\",\n    \"test:frontend\": \"pnpm --filter @app/web-admin --if-present run test\",\n    \"format\": \"prettier --write .\",\n    \"format:check\": \"prettier --check .\",\n    \"ci\": \"pnpm lint && pnpm typecheck && pnpm test\"\n  }\n}\n```\n\n**Comportament pe skeleton (repo fără cod):**\n- `pnpm lint` → exit 0 (nimic de lintat)\n- `pnpm typecheck` → exit 0 (--if-present skip dacă nu există script)\n- `pnpm test` → exit 0 (--if-present skip dacă nu există script)\n\n**În fiecare workspace, adaugă scripturi stub:**\n```json\n{\n  \"scripts\": {\n    \"typecheck\": \"tsc --noEmit\",\n    \"test\": \"echo 'No tests yet' && exit 0\",\n    \"build\": \"tsc -b\"\n  }\n}\n```\n\n**NOTĂ:** Folosim `--if-present` pentru a evita erorile pe workspaces care nu au încă scriptul respectiv.",
        "cale_implementare": "/package.json (root) + apps/*/package.json + packages/*/package.json",
        "contextul_anterior": "F1.4 CI presupune că pnpm ci funcționează. Fără scripturi deterministe, CI va pica imediat.",
        "validare_task": "Rulează `pnpm ci` la root pe repo skeleton - trebuie să returneze exit code 0. Verifică că `pnpm lint`, `pnpm typecheck`, `pnpm test` individual returnează 0.",
        "outcome_task": "Scripturile CI sunt definite și funcționează determinist chiar înainte de a exista cod sursă.",
        "restrictii_antihalucinatie": "NU lăsa scripturi care pică pe repo gol. NU folosi 'exit 1' în stubs. FOLOSEȘTE --if-present pentru a skip workspaces fără script."
    },

    {
        "id_task": "F1.1.10",
        "denumire_task": "Standardizare secrets management și promovare dev/staging/prod",
        "descriere_task": "Definește convenția unică pentru variabile sensibile și modul lor de livrare. Livrează `.env.example` cu lista completă de variabile obligatorii (ex: SHOPIFY_API_KEY/SECRET/SCOPES, POSTGRES_URL, REDIS_URL, BULLMQ_PRO_TOKEN, NPM_TASKFORCESH_TOKEN, OPENAI_API_KEY, ENCRYPTION_KEY_256, APP_HOST, OTEL_EXPORTER_OTLP_ENDPOINT). Stabilește regula: niciun secret în repo, .env local doar pentru dev, staging/prod prin OpenBAO (self-hosted în Docker) și injectare în runtime (OpenBAO Agent template → env-file montat read-only / folosit ca --env-file la docker compose). CI (GitHub Actions) declanșează deploy; accesul la OpenBAO este auditat și credențialele sunt rotabile. Documentează rotația trimestrială a cheilor (Shopify tokens, BullMQ Pro, OpenAI, chei AES) și traseul auditabil pentru acces la secrete.",
        "cale_implementare": "Rădăcina repo (.env.example), document intern în Docs/ sau README",
        "contextul_anterior": "Planul are .env pentru compose, dar nu există standard pentru secretele aplicației și promovarea între medii.",
        "validare_task": "Există `.env.example` versionat cu toate variabilele obligatorii, .env este în .gitignore, iar README/Wiki menționează fluxul dev → CI → staging/prod via OpenBAO. CI are setate secretele critice (NPM_TASKFORCESH_TOKEN, SHOPIFY_API_KEY/SECRET, BULLMQ_PRO_TOKEN, OPENAI_API_KEY) și rulează fără hardcodări. Documentația include regula de rotație și responsabilul.",
        "outcome_task": "Secret management-ul este standardizat și reproductibil; onboarding-ul și rotația sunt clare, iar promovarea dev/staging/prod nu depinde de fișiere locale.",
        "restrictii_antihalucinatie": "Nu comite fișiere .env cu valori reale. Nu stoca token-uri în .npmrc; folosește variabile de mediu (NPM_TASKFORCESH_TOKEN). Nu lăsa variabile obligatorii nedeclarate în .env.example."
    },

    {
        "id_task": "F1.1.11",
        "denumire_task": "Configurare opțională: integrare Turborepo pentru orchestrarea build-urilor",
        "descriere_task": "(Opțional) Adaugă suport pentru Turborepo în monorepo pentru a optimiza rularea scripturilor și caching-ul de build. Instalează dev-dependența `turbo` la root (`pnpm add -D turbo`). Creează un fișier `turbo.json` la rădăcină cu o configurație minimală pentru pipeline-urile de build/dev (de exemplu, targetul 'build' să depindă de build-urile pachetelor dependente și să aibă output `dist/**`, iar targetul 'dev' să nu folosească caching). Acest fișier va defini cum se execută în paralel sau secvențial procesele în monorepo. Salvează fișierul.",
        "cale_implementare": "/Neanelu_Shopify/turbo.json",
        "contextul_anterior": "Monorepo funcționează cu pnpm, însă pentru eficiență sporită s-a recomandat un tool de orchestrare. Acest pas implementează configurația pentru Turborepo, deși nu este obligatorie.",
        "validare_task": "Verifică `package.json` root că are acum și script-ul 'build' configurat (din pasul anterior) și că `turbo` apare în devDependencies. Deschide `turbo.json` și asigură-te că sintaxa JSON este validă. Testează comanda `pnpm turbo run build` (sau `pnpm dlx turbo run build`) pentru a vedea că este acceptată – deocamdată nu va produce output semnificativ deoarece pachetele nu au scripturi de build încă, dar nu trebuie să dea erori de configurare.",
        "outcome_task": "Monorepo-ul are integrat Turborepo ca utilitar de orchestrare, pregătit să accelereze procesele de build/test pe măsură ce proiectul crește (task opțional finalizat cu succes).",
        "restrictii_antihalucinatie": "Nu folosi Turborepo dacă echipa nu este familiarizată sau dacă adaugă complexitate nejustificată. Acest pas poate fi sărit dacă monorepo-ul este simplu. Dacă se implementează, nu configura pipeline-uri complexe prematur – ne limităm la setup-ul de bază până când apare nevoia reală."
    }
    ```

### F1.2: Containerizare (Infrastructure as Code – mediu local)

    ```JSON
    {
        "id_task": "F1.2.1",
        "denumire_task": "Standardizare env: un singur template (.env.example)",
        "descriere_task": "**STANDARD RECOMANDAT:** Folosește un singur fișier template comis: `.env.example`. Acesta conține atât variabilele aplicației, cât și cele necesare pentru Docker Compose (Traefik/DB/Redis/OTel).\n\nSetup:\n- `cp .env.example .env` (fișier local, NU se comite)\n- completează valorile reale (secretele nu ajung în repo)\n\n**IMPORTANT:**\n- `.env.example` SE COMITE (template)\n- `.env` NU SE COMITE (valori locale / prod injectate din secret manager)",
        "cale_implementare": "/Neanelu_Shopify/.env.example",
        "contextul_anterior": "Structura aplicației este definită. Urmează pregătirea serviciilor externe. `.env` nu se comite niciodată; folosim `.env.example` ca template.",
        "validare_task": "Verifică existența `.env.example` și că include variabilele necesare pentru docker-compose. CONFIRMĂ că `.env` este în `.gitignore`. Copiază `.env.example` în `.env` pentru uz local.",
        "outcome_task": "Template-ul pentru variabile Docker este versionat, în timp ce valorile reale rămân locale și necomise.",
        "restrictii_antihalucinatie": "NU comite niciodată `.env` cu valori reale. Păstrează un singur template comis (`.env.example`) și asigură-te că include toate variabilele obligatorii pentru Docker Compose și aplicație."
    },

    {
        "id_task": "F1.2.2",
        "denumire_task": "Definire serviciu Postgres (docker-compose base + dev override)",
        "descriere_task": "Creează `docker-compose.yml` (setări comune) și `docker-compose.dev.yml` (override local). În fișierul base definește serviciul `db` cu imaginea `postgres:18.1-alpine`, volum named și rețea. În override adaugă mapările de port (ex: `65010:5432`) și environment cu referințe din `.env` (POSTGRES_USER/PASSWORD/DB). Astfel, fișierul base rămâne neutru, iar specificul dev stă în override.",
        "cale_implementare": "/Neanelu_Shopify/docker-compose.yml (base) și /Neanelu_Shopify/docker-compose.dev.yml (override) — serviciul db",
        "contextul_anterior": "Fișierul .env este pregătit cu variabilele necesare. Începem să definim serviciile containerizate cu separare clară base vs. dev override.",
        "validare_task": "Deschide `docker-compose.yml` și `docker-compose.dev.yml` și verifică secțiunea `db`. Rulează `docker compose -f docker-compose.yml -f docker-compose.dev.yml config` pentru a valida configurația combinată și volumul named.",
        "outcome_task": "Serviciul Postgres este definit cu fișier base și override de dezvoltare, asigurând consistență între medii și porturi doar în dev.",
        "restrictii_antihalucinatie": "Nu pune parole în clar în docker-compose (folosește referințe la .env). Nu folosi imagine nespecifică (versiune 'latest' fără tag) – pentru reproductibilitate indică versiunea. Nu trece mai departe până când fișierul compose nu este valid sintactic."
    },

    {
        "id_task": "F1.2.3",
        "denumire_task": "Definire serviciu Redis 8.4 (base + dev override)",
        "descriere_task": "În `docker-compose.yml` (base) adaugă serviciul `redis` cu imagine `redis:8.4` și volum named. În `docker-compose.dev.yml` mapează porturile `65011:6379`. Modulele RedisJSON/RediSearch sunt incluse nativ în Redis 8.4 (nu mai e nevoie de redis-stack).",
        "cale_implementare": "/Neanelu_Shopify/docker-compose.yml și /Neanelu_Shopify/docker-compose.dev.yml (serviciul redis)",
        "contextul_anterior": "Serviciul de bază de date este definit. Următorul serviciu extern este Redis 8.4 pentru cozi, cache și vector search.",
        "validare_task": "Rulează `docker compose -f docker-compose.yml -f docker-compose.dev.yml config` și verifică secțiunea `redis:` (imagine, porturi, volume). Confirmă că volumul named este în secțiunea globală `volumes:`.",
        "outcome_task": "Redis 8.4 este definit cu un fișier base și override dev, păstrând consistența și expunând porturile doar în dev.",
        "restrictii_antihalucinatie": "Folosește imaginea `redis:8.4` (NU redis-stack care e deprecated Dec 2025). Redis 8.4 include nativ RediSearch/RedisJSON. Nu omite maparea portului 65011:6379."
    },

    {
        "id_task": "F1.2.4",
        "denumire_task": "Definire serviciu Jaeger (base + dev override)",
        "descriere_task": "Adaugă serviciul `jaeger` în `docker-compose.yml` (base) cu imagine `jaegertracing/all-in-one:1.41`. În `docker-compose.dev.yml` mapează portul UI 65020:16686 (și 6831 dacă e nevoie). Nu sunt necesare variabile custom în dev; all-in-one are configurare implicită.",
        "cale_implementare": "/Neanelu_Shopify/docker-compose.yml și /Neanelu_Shopify/docker-compose.dev.yml (serviciul jaeger)",
        "contextul_anterior": "Pe lângă DB și cache, sistemul de observabilitate prin tracing este dorit. Definim Jaeger cu separare base/override pentru consistență între medii.",
        "validare_task": "Rulează `docker compose -f docker-compose.yml -f docker-compose.dev.yml config` și verifică secțiunea `jaeger:` (imagine și porturi). După start, confirmă UI pe http://localhost:65020.",
        "outcome_task": "Jaeger este definit cu fișier base + override dev, completând suita de servicii de suport pentru dezvoltare.",
        "restrictii_antihalucinatie": "Nu expune porturi nenecesare ale Jaeger (doar UI-ul și eventual receiver-ul principal). Nu utiliza o versiune prea veche de Jaeger all-in-one; alege una modernă compatibilă cu OpenTelemetry 2025. Nu continua fără a include acest serviciu dacă monitoringul/tracing-ul este un obiectiv asumat al proiectului."
    },

    {
        "id_task": "F1.2.5",
        "denumire_task": "Pornirea containerelor de dezvoltare (docker compose cu override)",
        "descriere_task": "În terminal, execută `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d` în directorul proiectului. Aceasta va porni serviciile `db`, `redis` și `jaeger` cu setările de dev. Așteaptă câteva secunde pentru inițializare. Verifică starea cu `docker compose ps` – ar trebui să vezi serviciile 'Up' (eventual 'healthy' pentru db).",
        "cale_implementare": "Mediul local de dezvoltare (docker daemon)",
        "contextul_anterior": "Fișierul docker-compose este definit cu serviciile necesare. Acum le pornim efectiv pentru a fi disponibile în mediul de dezvoltare.",
        "validare_task": "După rulare, folosește `docker compose ps` pentru a verifica că serviciile sunt 'Up'. Poți rula `docker compose logs -f db` pentru a vedea dacă Postgres este ready.",
        "outcome_task": "Stack-ul de servicii dev pornește folosind combinația base+override, gata pentru dezvoltare.",
        "restrictii_antihalucinatie": "Nu trece peste eventualele erori de pornire – dacă un container se oprește imediat (ex: Postgres din cauza unei variabile lipsă), rezolvă înainte de a continua. Nu porni containere în mod interactiv (fără -d) în acest stadiu, pentru a nu bloca terminalul; modul daemon (-d) e necesar. Nu continua dezvoltarea aplicației fără ca aceste servicii să ruleze, altfel testele locale ar eșua."
    },

    {
        "id_task": "F1.2.6",
        "denumire_task": "Verificarea conectivității Postgres și Redis 8.4 (folosind docker exec - NU instalări pe host)",
        "descriere_task": "**IMPORTANT:** Conform principiului 'nu instalăm Postgres/Redis local', verificările se fac DOAR prin containere.\n\n**1. Verificare Postgres (docker exec):**\n```bash\ndocker compose exec db psql -U shopify -d neanelu_shopify_dev -c 'SELECT 1;'\n```\nTrebuie să returneze `1` fără erori.\n\n**2. Verificare Redis 8.4 (docker exec):**\n```bash\n# PING test\ndocker compose exec redis redis-cli ping\n# Trebuie să returneze PONG\n\n# Verifică module RediSearch/RedisJSON (incluse nativ în Redis 8.4)\ndocker compose exec redis redis-cli MODULE LIST\n# Trebuie să listeze: search, ReJSON, bf (bloom filter), etc.\n\n# Alternativ, test specific RediSearch:\ndocker compose exec redis redis-cli FT._LIST\n# Returnează array gol [] (OK) sau eroare (NOK)\n```\n\n**3. (Opțional) PgAdmin pentru DX:**\nDacă echipa vrea un GUI pentru Postgres, adaugă în docker-compose.dev.yml:\n```yaml\n  pgadmin:\n    image: dpage/pgadmin4:latest\n    ports:\n      - \"65030:80\"\n    environment:\n      PGADMIN_DEFAULT_EMAIL: admin@local.dev\n      PGADMIN_DEFAULT_PASSWORD: admin\n    depends_on:\n      - db\n```\nAccesibil la http://localhost:65030",
        "cale_implementare": "Conexiuni prin docker exec - NU instalări pe host",
        "contextul_anterior": "Containerele sunt pornite. Trebuie să verificăm conectivitatea FĂRĂ a instala software pe host.",
        "validare_task": "Toate comenzile docker exec returnează succes. MODULE LIST include 'search' și 'ReJSON'. NU ai instalat psql sau redis-cli pe host.",
        "outcome_task": "Serviciile Postgres și Redis 8.4 sunt funcționale și verificate prin containere. Niciun drift între mașinile de dev.",
        "restrictii_antihalucinatie": "NU instala psql, redis-cli sau alte tool-uri pe host - folosește DOAR docker exec. NU ignora lipsa modulelor RediSearch/RedisJSON - dacă lipsesc, ai folosit imaginea greșită (trebuie redis:8.4)."
    },

    {
        "id_task": "F1.2.7",
        "denumire_task": "Integrarea rulării containerelor în fluxul de dezvoltare (script pnpm)",
        "descriere_task": "Adaugă în `package.json` (la root) scripturi care folosesc combinația base+override:\n- **db:up**: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`\n- **db:down**: `docker compose -f docker-compose.yml -f docker-compose.dev.yml down`\nOpțional un `db:refresh` care face down & up. Documentează aceste scripturi pentru echipă.",
        "cale_implementare": "/Neanelu_Shopify/package.json (scripts)",
        "contextul_anterior": "Serviciile rulează, iar dezvoltatorii le pot porni/opri manual. Automatizarea acestor comenzi în scripturi pnpm asigură consecvența și ușurința utilizării pentru toți membrii echipei.",
        "validare_task": "Examinează `package.json` și confirmă scripturile `db:up`/`db:down`. Rulează `pnpm run db:down` (verifică cu `docker compose ps` că sunt oprite), apoi `pnpm run db:up` pentru restart. Confirmă funcționarea.",
        "outcome_task": "Scripturile pnpm controlează stack-ul folosind base+override, oferind pornire/oprire consecventă în dev.",
        "restrictii_antihalucinatie": "Nu uita să oprești containerele atunci când nu le folosești (evităm consumul inutil de resurse) – scriptul `db:down` ajută la asta. Nu introduce scripturi complexe care să șteargă volume sau să refacă imagini, decât dacă e necesar – păstrează aceste scripturi simple și sigure."
    },

    {
        "id_task": "F1.2.8",
        "denumire_task": "Commit & push configurările Docker (FĂRĂ .env!)",
        "descriere_task": "Adaugă fișierele noi și modificate la Git:\n\n**SE COMIT:**\n- `docker-compose.yml`\n- `docker-compose.dev.yml`\n- `.env.example` (singurul template de env)\n- actualizările `package.json` cu scripturile db:up/down\n\n**NU SE COMIT (verifică .gitignore):**\n- `.env` (valori reale / secrete)\n\nEfectuează un commit cu mesajul 'Add docker-compose config for Postgres, Redis 8.4, Jaeger'. Apoi, împinge modificările la remote.",
        "cale_implementare": "Repository Git local (și remote origin)",
        "contextul_anterior": "Mediul containerizat este pregătit și verificat. Este esențial să înregistrăm doar template-urile, NU valorile reale.",
        "validare_task": "VERIFICĂ `git status` - `.env` NU trebuie să apară în lista de fișiere staged. Doar `.env.example` trebuie să fie comis ca template. După commit, verifică pe GitHub că `.env` NU apare în repository.",
        "outcome_task": "Configurația Docker este versionată cu template-uri, fără secrete sau valori locale.",
        "restrictii_antihalucinatie": "NU COMITE niciodată `.env` cu valori reale. Păstrează un singur template comis (`.env.example`). Verifică DE DOUĂ ORI .gitignore înainte de commit. Dacă vezi `.env` în `git status`, oprește-te și adaugă-l în .gitignore!"
    },

    {
        "id_task": "F1.2.9",
        "denumire_task": "Pregătire infrastructură OTel (Jaeger ready + skeleton files DOAR)",
        "descriere_task": "**NOTA:** Implementarea completă OTel vine DUPĂ ce există un backend runnable (F2). În F1 pregătim doar INFRASTRUCTURA:\n\n1. **Jaeger este deja în docker-compose** - verifică că pornește și UI-ul e accesibil pe http://localhost:65020\n\n2. **Crează skeleton files:**\n   - `packages/logger/src/index.ts` - export gol, placeholder\n   - `packages/logger/src/otel.ts` - comentariu 'OTel setup va fi implementat în F2'\n\n3. **Adaugă în .env.example** (deja făcut în F0.2.7.1):\n   - OTEL_EXPORTER_OTLP_ENDPOINT\n   - OTEL_SERVICE_NAME\n\n**NU IMPLEMENTA încă:**\n- SDK initialization\n- Trace exporters\n- Logging structurat\n\nAcestea vin în F2-F3 când există un main.ts + healthcheck.",
        "cale_implementare": "packages/logger/src/ (skeleton files)",
        "contextul_anterior": "Jaeger este disponibil în docker-compose. **CLARIFICARE IMPORTANTĂ:** În F1.2.9 pregătim DOAR infrastructura (Jaeger container + skeleton files pentru packages/logger). NU implementăm OTel SDK complet aici deoarece nu există încă un server care să emită span-uri. **Cronologie OTel:** F1.2.9 = infrastructură → F2 = data layer (fără OTel) → F3.1 = server Fastify → F3.4 = OTel SDK complet cu tracing HTTP/webhooks.",
        "validare_task": "Verifică că Jaeger UI (http://localhost:65020) funcționează. Verifică existența skeleton-urilor în packages/logger/src/. NU aștepta span-uri - ele vor apărea în F2.",
        "outcome_task": "Infrastructura de observabilitate (Jaeger) e pregătită. Skeleton-ul logger + OTel eșafodat, gata pentru implementare în F2.",
        "restrictii_antihalucinatie": "NU încerca să implementezi OTel complet acum - nu ai încă un server care să-l folosească. NU pierde timp cu sampling/tracing fără cod care să emită span-uri."
    }
    ```

### F1.3: Standardizare Git Hooks (automatizare calitate cod)

    ```JSON
    {
        "id_task": "F1.3.1",
        "denumire_task": "Instalare dependințe pentru hooks (Husky și lint-staged)",
        "descriere_task": "Adaugă la proiect pachetele necesare pentru implementarea hook-urilor Git de calitate a codului. În directorul rădăcină, rulează: `pnpm add -D husky lint-staged` pentru a instala Husky (gestionarul de hooks Git) și lint-staged (pentru a rula automat lintere pe fișierele staged). Acestea se vor adăuga ca dependențe de dezvoltare în `package.json` (verifică după instalare că apar sub devDependencies). De asemenea, asigură-te că există și ESLint și Prettier instalate (dacă nu, instalează-le tot ca devDependencies: `pnpm add -D eslint prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-config-prettier`).",
        "cale_implementare": "/Neanelu_Shopify/package.json (devDependencies)",
        "contextul_anterior": "Structura monorepo este stabilă și serviciile externe configurate. **IMPORTANT - ACEST TASK INSTALEAZĂ TOATE DEPENDENȚELE:** În F1.3.1 instalăm husky + lint-staged + ESLint + Prettier + plugin-uri TypeScript. F1.3.5 (Crearea configurărilor) creează doar FIȘIERELE de configurare (.eslintrc, .prettierrc), NU instalează pachete - pachetele sunt deja instalate aici în F1.3.1. Această ordine este corectă: instalare pachete → init husky → hook-uri → configurare lint-staged → creare fișiere config.",
        "validare_task": "Verifică secțiunea devDependencies din `package.json` și confirmă prezența pachetelor husky, lint-staged, eslint, prettier și a plugin-urilor/config-urilor ESLint menționate. Comanda de instalare trebuie să se fi încheiat cu succes (fără erori). Poți rula `pnpm ls husky lint-staged` pentru a vedea versiunile instalate și confirmarea că sunt rezolvate corect.",
        "outcome_task": "Dependențele necesare pentru hooks de pre-commit și pentru linting/formatting automat sunt instalate în proiect, pregătind terenul pentru configurarea lor.",
        "restrictii_antihalucinatie": "Nu trece mai departe dacă instalațiile dau erori – asigură-te că ai scris corect numele pachetelor. Nu instala global aceste unelte, ci local, în proiect, ca dependențe. Nu uita să includem și ESLint/Prettier, altfel configurarea hook-urilor nu va putea rula verificările dorite."
    },

    {
        "id_task": "F1.3.2",
        "denumire_task": "Inițializarea Husky și configurarea folderului de hooks",
        "descriere_task": "După instalare, inițiază Husky în proiect. Rulează `pnpm husky install` (sau `pnpm dlx husky install`, echivalent) de la rădăcină. Aceasta va crea un folder ascuns `.husky/` în rădăcina repository-ului. Verifică existența folderului `.husky`. Acest pas configurează Git să recunoască hook-urile definite acolo.\nÎn plus, adaugă în `package.json` sub secțiunea 'scripts' linia: 'prepare': 'husky install' (dacă nu a fost adăugată automat). Aceasta asigură că dacă altcineva face `pnpm install`, husky se va instala automat (hook-urile devin active).",
        "cale_implementare": "/Neanelu_Shopify/.husky/ (director) și /Neanelu_Shopify/package.json (script prepare)",
        "contextul_anterior": "Pachetele Husky și lint-staged sunt instalate. Trebuie să activăm Husky în repository pentru a putea începe să adăugăm hook-uri Git personalizate.",
        "validare_task": "Verifică că folderul `.husky/` există și conține cel puțin un fișier (ex: `_.gitignore` generat de husky). În `package.json`, caută scriptul 'prepare' – dacă nu e prezent, adăugarea lui manuală a fost necesară și acum ar trebui să fie acolo. Poți testa rulând `pnpm run prepare` – ar trebui să confirme că husky este deja instalat (sau să nu dea erori).",
        "outcome_task": "Husky este inițializat în proiect și configurat să se instaleze automat la `pnpm install`, pregătind utilizarea hook-urilor Git locale.",
        "restrictii_antihalucinatie": "Nu sări peste scriptul 'prepare' – fără acesta, colaboratorii ar trebui să ruleze manual husky install după fiecare clone/install, ceea ce e predispus la a fi uitat. Nu modifica manual fișiere interne husky (de ex: hooks sample) decât conform documentației. Asigură-te că .husky/ este versionat (nu în .gitignore), altfel hook-urile nu vor fi distribuite."
    },

    {
        "id_task": "F1.3.3",
        "denumire_task": "Adăugarea hook-ului pre-commit (Husky) pentru lint-staged",
        "descriere_task": "Creează un hook Git pre-commit folosind Husky. Execută comanda: `pnpm husky add .husky/pre-commit 'pnpm lint-staged'`. Aceasta va genera fișierul `.husky/pre-commit` cu permisiuni de executare, care la fiecare commit va rula comanda `pnpm lint-staged`. Deschide fișierul `.husky/pre-commit` și verifică faptul că conține linia de execuție a comenzii de mai sus (și shebang-ul `#!/bin/sh`).\nPrin acest setup, înainte ca un commit să fie înregistrat, lint-staged va rula, permițându-ne să definim acțiuni (lintare, formatare) pe fișierele modificate.",
        "cale_implementare": "/Neanelu_Shopify/.husky/pre-commit",
        "contextul_anterior": "Husky este instalat și folderul de hook-uri e prezent. **CLARIFICARE:** ESLint și Prettier au fost instalate în F1.3.1, deci lint-staged va putea rula comenzile ESLint/Prettier. Fișierele de configurare (.eslintrc, .prettierrc) vor fi create în F1.3.5 DAR pachetele sunt deja disponibile. Hook-ul poate fi creat înainte de fișierele de config deoarece: 1) hook-ul doar invocă `pnpm lint-staged`, 2) lint-staged citește configurația din package.json/lint-staged, 3) ESLint/Prettier funcționează cu default-uri până la crearea fișierelor custom.",
        "validare_task": "Listează fișierele în `.husky/` și confirmă existența `pre-commit`. Conținutul fișierului trebuie să includă comanda `pnpm lint-staged`. Asigură-te că fișierul are flag de executabil (Husky îl setează automat, dar poți verifica proprietățile pe sistem sau observa prefixul în listare `-rwxr-xr-x`). Simulează un commit (fără să finalizezi) cu `git commit -m 'test' --no-verify` ca să vezi că `--no-verify` îl sare, apoi fără acel flag pentru a observa dacă se invocă (poți pune un `echo` temporar în script pentru debug).",
        "outcome_task": "Hook-ul pre-commit este configurat; la fiecare încercare de commit, se va apela lint-staged (pas care urmează a fi configurat) pentru a rula verificările de calitate pe fișierele stagiate.",
        "restrictii_antihalucinatie": "Nu modifica manual fișierul pre-commit decât prin comenzi Husky (pentru a menține formatarea/permisiunile). Nu versiona hook-ul dacă nu conține comanda corectă. Nu uita să anunți echipa că de acum există o verificare automată la commit (pentru a evita confuzii când cineva vede că 'nu merge commit-ul')."
    },

    {
        "id_task": "F1.3.3.1",
        "denumire_task": "Extindere pre-commit: adaugă typecheck după lint-staged",
        "descriere_task": "**CONFORM DevOps_Plan_Implementare:** Pre-commit include și typecheck, nu doar lint/format.\n\n**Actualizează `.husky/pre-commit`:**\n```sh\n#!/usr/bin/env sh\n. \"$(dirname -- \"$0\")/_/husky.sh\"\n\n# 1. Lint și format fișierele staged\npnpm lint-staged\n\n# 2. Typecheck via root script (stabil, monorepo-safe)\npnpm -w run typecheck\n```\n\n**Notă despre Husky 9+:**\nHusky 9+ folosește sintaxă diferită de `husky add`. Metoda manuală (editare directă `.husky/pre-commit`) este mai fiabilă și portabilă.\n\n**Alternativă rapidă (typecheck doar pe fișierele staged):**\n```sh\npnpm lint-staged --config .lintstagedrc.typecheck.json\n```\nUnde `.lintstagedrc.typecheck.json` conține:\n```json\n{\n  \"*.{ts,tsx}\": \"tsc-files --noEmit\"\n}\n```\n(Necesită `pnpm add -D tsc-files`)",
        "cale_implementare": "/.husky/pre-commit",
        "contextul_anterior": "Pre-commit rulează lint-staged, dar conform Docs, trebuie și typecheck.",
        "validare_task": "Fă o modificare cu eroare de tip (ex: `const x: number = 'string'`) și încearcă commit. Trebuie să fie blocat de typecheck. Corectează și reîncercă - trebuie să treacă.",
        "outcome_task": "Pre-commit validează atât lint/format cât și tipurile TypeScript.",
        "restrictii_antihalucinatie": "NU folosesc `pnpm tsc` direct - folosește `pnpm -w run typecheck` pentru a folosi scriptul definit. VERIFICĂ versiunea Husky și adaptează sintaxa."
    },

    {
        "id_task": "F1.3.4",
        "denumire_task": "Configurarea acțiunilor lint-staged (ESLint și Prettier)",
        "descriere_task": "Definește în `package.json` (sau într-un fișier separat de configurare) ce comenzi să ruleze lint-staged pe fișierele ce vor fi comise. De exemplu, configurează-l astfel încât pentru fișierele sursă TypeScript/JavaScript (`*.ts, *.tsx, *.js, *.jsx`) să ruleze `eslint --fix`, iar pentru fișiere de cod și documentație (`*.ts, *.tsx, *.js, *.jsx, *.json, *.md`) să ruleze formatarea Prettier (`prettier --write`). Ajustează pattern-urile și comenzile în funcție de nevoile proiectului (de exemplu, poți adăuga verificări pentru fișiere CSS etc.).",
        "cale_implementare": "/Neanelu_Shopify/package.json (secțiunea lint-staged)",
        "contextul_anterior": "Hook-ul pre-commit invocă lint-staged, dar nu are încă definit ce să facă. **ORDINE LOGICĂ:** F1.3.1 a instalat ESLint/Prettier. F1.3.3 a creat hook-ul. Acum definim CE comenzi rulează lint-staged. Fișierele de configurare ESLint/Prettier (F1.3.5) pot fi create după deoarece pachetele funcționează cu default-uri. Configurația lint-staged (CE comenzi rulezi) este separată de configurația ESLint/Prettier (CE reguli aplici).",
        "validare_task": "Verifică în `package.json` că secțiunea `lint-staged` există și conține intrările corecte (pattern-urile de fișiere și comenzile). Simulează un caz: modifică un fișier TypeScript intenționat greșit formatat (ex. cu spațieri aiurea), fă `git add` și apoi `git commit -m 'test lint-staged'`. Ar trebui ca Prettier să ruleze și să formateze automat fișierul (poți vedea modificările de format dacă anulezi commit-ul după). De asemenea, ESLint cu --fix ar trebui să corecteze probleme simple. Dacă commit-ul trece (sau este oprit de vreo eroare de lint nereparabilă automat), înseamnă că lint-staged e funcțional.",
        "outcome_task": "Configurația lint-staged este în vigoare, asigurând că înainte de fiecare commit, codul este formatat și verificat conform regulilor stabilite (cel puțin pentru categoriile de fișiere specificate).",
        "restrictii_antihalucinatie": "Nu pune comenzi care modifică fișiere fără să fie și comise (prin design, lint-staged adaugă modificările făcute de Prettier în commit automat). Nu lăsa pattern-uri prea largi care să includă fișiere mari binare sau altele ne-necessare – țintește doar codul sursă. Nu continua fără să testezi că configurația chiar rulează la commit (pentru a evita falsa siguranță)."
    },

    {
        "id_task": "F1.3.5",
        "denumire_task": "Crearea configurărilor ESLint și Prettier",
        "descriere_task": "În rădăcina proiectului, adaugă fișierele de configurare pentru ESLint și Prettier. Creează un fișier `.eslintrc.json` cu o configurație de bază care extinde regulile recomandate pentru JavaScript și TypeScript (de ex. eslint:recommended și plugin:@typescript-eslint/recommended) și include integrarea Prettier (pentru a dezactiva regulile conflictuale de stil). Setează `parser` la `@typescript-eslint/parser` și `plugins` la `[ @typescript-eslint ]`. De asemenea, definește environment-urile relevante (ex: node: true, browser: false, es2020: true).\nCreează și un fișier `.prettierrc` simplu cu reguli de formatare dorite (ex: lățime maximă 100 de caractere, ghilimele simple la stringuri etc., conform preferințelor echipei). Nu uita să adaugi un fișier `.eslintignore` care să excludă `node_modules/` și eventual alte fișiere generate, precum și un `.prettierignore` similar (poți porni de la același conținut ca .eslintignore).",
        "cale_implementare": "/Neanelu_Shopify/.eslintrc.json, /Neanelu_Shopify/.prettierrc",
        "contextul_anterior": "**CLARIFICARE FINALĂ - ACEST TASK CREEAZĂ FIȘIERE, NU INSTALEAZĂ PACHETE:** ESLint și Prettier au fost instalate în F1.3.1. Hook-urile sunt configurate în F1.3.3-F1.3.4. Acum creăm fișierele de configurare (.eslintrc.json/ eslint.config.js, .prettierrc, .eslintignore, .prettierignore) pentru a personaliza regulile. Această ordine este INTENȚIONATĂ: pachetele instalate mai întâi permit hook-urilor să funcționeze cu default-uri, iar fișierele de config vin la final pentru personalizare.",
        "validare_task": "Deschide `.eslintrc.json` și verifică că JSON-ul este valid și conține extensiile/pluginurile așteptate. Testează ESLint rulând manual `pnpm eslint .` la rădăcina proiectului – ar trebui să parseze fișierele (chiar dacă încă nu avem cod real, nu trebuie să dea erori de configurare). Verifică `.prettierrc` că e în format JSON valid. Eventual, rulează `pnpm prettier -c '*.ts'` pentru a verifica că Prettier nu găsește probleme de config ('Checked 0 files' e ok dacă nu sunt fișiere; important e să nu dea eroare de sintaxă config).",
        "outcome_task": "Configurările ESLint și Prettier sunt prezente, permițând editorilor și CI-ului (pe viitor) să aplice stilul de cod în mod consistent, conform deciziilor echipei.",
        "restrictii_antihalucinatie": "Nu lăsa configurațiile la voia întâmplării – dacă extensiile recommended nu acoperă tot, discută și ajustează (dar pentru start e ok). Nu include reguli prea stricte care să blocheze development-ul (le poți adăuga treptat). Nu uita să ignorezi node_modules și alte fișiere generate – altfel linterul va irosi timp și va produce fals pozitive."
    },

    {
        "id_task": "F1.3.6",
        "denumire_task": "Testarea locală a hook-ului pre-commit",
        "descriere_task": "Efectuează un test complet al fluxului de pre-commit pe o schimbare reală: editează un fișier sursă din proiect introducând deliberat o încălcare de stil (de ex., un console.log nefolosit sau formatat incorect într-un fișier .ts existent sau nou pe care îl creezi special). Fă `git add` pentru acel fișier și rulează `git commit -m 'Test hooks'`. Observă output-ul: ar trebui să vezi lint-staged rulând ESLint și Prettier. Dacă încălcarea de stil poate fi remediată de Prettier/ESLint --fix, commit-ul va trece după aplicarea fix-urilor (modificările sunt incluse automat în commit). Dacă este o eroare pe care ESLint nu o poate corecta automat (ex: no-unused-vars), commit-ul va fi blocat cu un mesaj de eroare. Acesta este comportamentul dorit – codul care nu trece de linter nu ar trebui commis. În acest caz, corectează eroarea și recommitează.",
        "cale_implementare": "Mediul local (executare hook pre-commit via Git)",
        "contextul_anterior": "Configurările au fost realizate. Este important să verificăm că întreg lanțul funcționează corect înainte de a ne baza pe el.",
        "validare_task": "Dacă commit-ul de test a fost oprit de hook (în caz de erori) sau a trecut după ce a rulat formatările, atunci mecanismul funcționează. Verifică conținutul fișierului pe care l-ai modificat: ar trebui să fie formatat conform așteptărilor (semn că Prettier a rulat). De asemenea, introdu deliberat o greșeală de lint imposibil de auto-fixat, precum un `debugger` sau o variabilă nefolosită, și asigură-te că hook-ul blochează commit-ul. Astfel validăm ambele scenarii.",
        "outcome_task": "Hook-urile de pre-commit cu lint-staged, ESLint și Prettier funcționează corect: formatează automat codul și împiedică introducerea pe branch a codului care nu respectă regulile de lint.",
        "restrictii_antihalucinatie": "Nu considera testarea completă până nu vezi cu ochii tăi output-ul hook-ului. Nu dezactiva hook-urile (`--no-verify`) decât în cazuri excepționale aprobate de echipă. Scopul este să menținem disciplină, deci nu sărim peste acest pas de test. Orice problemă identificată acum (ex: un tip de fișier neformatat) trebuie adresată în configurația lint-staged înainte de a continua."
    },

    {
        "id_task": "F1.3.7",
        "denumire_task": "Commit configurări Husky/lint-staged și documentarea acestora",
        "descriere_task": "După ce totul funcționează, adaugă la Git fișierele de configurare create/modificate: `.husky/` (directorul și fișierele sale), `package.json` (cu secțiunea lint-staged și scripturile adăugate), `.eslintrc.json`, `.prettierrc`, `.eslintignore` etc. Realizează un commit cu mesajul 'Configure code quality tools: ESLint, Prettier, Husky hooks'.\nActualizează documentația (README sau wiki intern) pentru a menționa existența acestor hook-uri și modul de utilizare (de ex., cum pot rula manual `pnpm lint` sau `pnpm format` dacă doresc, și semnalarea faptului că un commit poate fi blocat până nu trec testele de lint).\nÎn final, trimite (`git push`) modificările astfel încât toți colegii să beneficieze de aceeași configurație.",
        "cale_implementare": "Repository Git local + documentație (README/Wiki)",
        "contextul_anterior": "Hook-urile și uneltele de calitate a codului au fost configurate și testate. E momentul să le salvăm în repository și să comunicăm echipei despre ele.",
        "validare_task": "Verifică că, după commit, comanda `git status` nu arată fișiere neversionate legate de configurările de lint/hook (semn că le-ai inclus pe toate). Pe platforma remote, navighează la fișierele de configurare și asigură-te că se văd corect. Citește README-ul actualizat și vezi dacă informația este clară pentru un nou venit. Eventual, cere cuiva din echipă să urmeze instrucțiunile și să verifice că totul e clar.",
        "outcome_task": "Toate configurările legate de calitatea codului (lint, format, hooks) sunt versionate și documentate. De acum, orice contributor va avea aceleași verificări local și codul din repo va rămâne curat și uniform formatat.",
        "restrictii_antihalucinatie": "Nu omite actualizarea documentației – un tool neanunțat poate deruta colegii. Nu folosi mesaje de commit vagi, precizează clar configurarea uneltelor de calitate a codului. Asigură-te că niciun fișier esențial (precum .husky/pre-commit sau .eslintrc) nu rămâne necomis; altfel, alții nu vor avea parte de aceeași configurare."
    },

    {
        "id_task": "F1.3.7.1",
        "denumire_task": "Pre-push hook: rulare teste înainte de push (sau decizie documentată 'tests doar în CI')",
        "descriere_task": "**CONFORM DevOps_Plan_Implementare:** Pre-push rulează testele pentru a preveni push-uri cu cod broken.\n\n**Opțiunea A: Pre-push hook (recomandat pentru echipe mici):**\n```sh\n#!/usr/bin/env sh\n. \"$(dirname -- \"$0\")/_/husky.sh\"\n\necho '🧪 Running tests before push...'\n\n# Rulează testele via root script (stabil, monorepo-safe)\npnpm -w run test || exit 1\n\necho '✅ All tests passed!'\n```\n\nCreare: `pnpm husky add .husky/pre-push \"pnpm -w run test || exit 1\"`\n\n**Opțiunea B: Tests doar în CI (documentat explicit):**\nDacă pre-push e prea lent sau echipa preferă feedback rapid local:\n1. NU adăuga pre-push hook\n2. Documentează în README/CONTRIBUTING.md:\n```markdown\n## Testing Policy\nTestele rulează **doar în CI** (GitHub Actions pe PR).\nDevelopers pot rula manual: `pnpm test`\n```\n3. CI-ul din F1.4 este OBLIGATORIU în acest caz.\n\n**DECIZIE EXPLICITĂ necesară:** Alege A sau B și documentează.",
        "cale_implementare": "/.husky/pre-push SAU /README.md (politica)",
        "contextul_anterior": "Pre-commit verifică lint/typecheck. Pre-push poate rula teste, sau testele pot fi delegate CI-ului.",
        "validare_task": "Dacă A: `git push` blocată cu teste eșuate. Dacă B: README conține politica explicită și CI-ul din F1.4 este configurat.",
        "outcome_task": "Decizie explicită și documentată: teste în pre-push SAU teste doar în CI. Echipa știe exact ce să aștepte.",
        "restrictii_antihalucinatie": "NU folosi `node --test` cu glob-uri fragile - folosește `pnpm -w run test` pentru a folosi scriptul definit cu --if-present. ALEGE explicit A sau B și documentează."
    }
    ```

### F1.4: Skeleton CI/CD devreme (lint/typecheck/test + Docker smoke)

    ```JSON
    {
        "id_task": "F1.4.1",
        "denumire_task": "Workflow GitHub Actions pe PR (lint/typecheck/test cu cache pnpm)",
        "descriere_task": "Creează un workflow `.github/workflows/ci-pr.yml` care rulează la pull request. Pași minimi: checkout, setup Node 24 + pnpm (cu cache), pnpm install, pnpm lint, pnpm typecheck, pnpm test (backend pe `node --test`, frontend pe Vitest). Include servicii efemere Postgres 18.1 și Redis 8.4.0 pentru testele de integrare. Activează concurrency per branch pentru a evita cozi inutile și publică artefacte junit/coverage pentru debugging rapid.",
        "cale_implementare": ".github/workflows/ci-pr.yml",
        "contextul_anterior": "Hook-urile locale sunt configurate; lipsesc verificările automate pe PR pentru a prinde devreme probleme de lint/type/packaging.",
        "validare_task": "Deschide un PR de test cu o schimbare minoră; workflow-ul trebuie să ruleze și să treacă toate job-urile lint/type/test. Verifică în UI-ul GitHub că artefactele junit/coverage sunt atașate și că serviciile Postgres/Redis pornesc corect.",
        "outcome_task": "Orice PR execută automat lint/type/test pe monorepo cu cache pnpm și servicii efemere, reducând riscul de defecte care apar târziu în F7.",
        "restrictii_antihalucinatie": "Nu sări peste pnpm cache (pentru performanță). Nu instala dependențe globale; rulează totul în workflow. Nu bloca workflow-ul dacă serviciile Postgres/Redis lipsesc local – folosim containerele din job."
    },

    {
        "id_task": "F1.4.2",
        "denumire_task": "Job de smoke Docker build în CI (fără push)",
        "descriere_task": "Adaugă un job separat în același workflow care execută `docker build` pe Dockerfile-ul principal (multi-stage) folosind contextul monorepo. Scop: detectează devreme probleme de ESM/paths/workspaces. Nu publică imaginea; doar construiește și aruncă layer-ele. Rulează după lint/type/test pentru a economisi minute.",
        "cale_implementare": ".github/workflows/ci-pr.yml (job docker-smoke)",
        "contextul_anterior": "Eșecurile de build Docker descoperite târziu în F7 pot bloca release-ul; avem nevoie de feedback timpuriu.",
        "validare_task": "Rulează workflow-ul pe PR și verifică logurile job-ului docker-smoke; build-ul trebuie să finalizeze fără erori. În caz de eșec (ex: lipsă fișiere, probleme pnpm), acestea sunt raportate acum, nu în săptămâna 8.",
        "outcome_task": "Dockerfile este verificat automat de la începutul proiectului, prevenind surprize de packaging în faza de livrare.",
        "restrictii_antihalucinatie": "Nu face push către registry în acest job. Nu crește imaginea cu pași suplimentari (e doar smoke). Folosește `--target` dacă e nevoie să eviți layerele de runtime costisitoare."
    },

    {
        "id_task": "F1.4.3",
        "denumire_task": "Scanare rapidă de securitate pe PR (trivy fs v0.69.0)",
        "descriere_task": "Include un pas de scanare rapidă a filesystem-ului sursă cu trivy (mod fs, v0.69.0) pentru a detecta CVE majore și dependențe compromise. Scanarea completă a imaginii (trivy image/grype) și semnarea SBOM rămân în F7, dar aici prindem devreme probleme critice de supply chain.",
        "cale_implementare": ".github/workflows/ci-pr.yml (pas scan-trivy-fs)",
        "contextul_anterior": "Nu există încă un control automat de securitate; adăugăm o verificare lightweight înainte de livrare finală.",
        "validare_task": "Rularea workflow-ului trebuie să afișeze raportul trivy fs (v0.69.0); dacă există CVE critice, job-ul e marcat failed. Verifică că durata rămâne rezonabilă (<2-3 minute) folosind cache local.",
        "outcome_task": "Pipeline-ul de PR blochează dependențele cu vulnerabilități critice și semnalează devreme probleme de supply chain.",
        "restrictii_antihalucinatie": "Nu înlocui această scanare cu trivy image (mai lent) în F1; păstrează verificarea rapidă. Nu ignora CVE critice fără documentare și ticket de remediere."
    }
    ```

## Faza F2: Data Layer și Schema Design (Săptămâna 2)

Durată: Săptămâna 2
Obiectiv: Stabilirea sursei de adevăr (PostgreSQL 18.1), migrații, RLS și seed data; fără logică business.

### F2.1: Configurare ORM/Query Builder pentru baza de date

    ```JSON
    [
    {
        "id_task": "F2.1.1",
        "denumire_task": "Configurare pachet DB (Drizzle ORM + pg driver + pg-copy-streams)",
        "descriere_task": "**CONFORM Stack Tehnologic Complet (secțiunea 4.1):** Instalează în `packages/database`:\n\n**Dependențe obligatorii:**\n```bash\npnpm add drizzle-orm pg pg-copy-streams stream-json --filter @app/database\npnpm add -D drizzle-kit @types/pg --filter @app/database\n```\n\n**Motivație alegere driver pg (NU postgres):**\n- `pg` (node-postgres v8.13.1+) este necesar pentru `pg-copy-streams` - pachetul cheie pentru COPY FROM STDIN\n- COPY FROM STDIN atinge zeci de mii de rânduri/secundă, esențial pentru ingestie 1M+ SKU\n- Un singur driver pentru tot (ORM + streaming) evită 2 pool-uri DB și duplicare RLS context\n\n**Configurare conexiune:**\n```typescript\n// packages/database/src/db.ts\nimport { drizzle } from 'drizzle-orm/node-postgres';\nimport { Pool } from 'pg';\n\nconst pool = new Pool({\n  connectionString: process.env.DATABASE_URL,\n  max: Number(process.env.DB_POOL_SIZE ?? 10),\n  idleTimeoutMillis: 30000,\n});\n\nexport const db = drizzle(pool);\nexport { pool }; // Export pool pentru pg-copy-streams\n```\n\n**Pool sizing (bare metal, 10 worker containers):**\n- Total conexiuni ≈ (replicas_api + 10 workers) × DB_POOL_SIZE + overhead\n- Recomandare inițială: DB_POOL_SIZE=5 în staging/prod (și DB_POOL_SIZE_MIGRATE=1 pentru migrații)\n- Dacă ai nevoie de mai multe job slots fără a crește conexiunile: crești concurrency BullMQ, nu pool-ul DB\n- Opțional: PgBouncer (transaction pooling) în fața Postgres pentru control strict al conexiunilor\n\n**stream-json** (v1.9.0+) este inclus pentru parsarea JSONL fișiere mari cu consum de memorie constant.",
        "cale_implementare": "/Neanelu_Shopify/packages/database/src/db.ts",
        "contextul_anterior": "Monorepo-ul există și Postgres 18.1 rulează în Docker (F1.2).",
        "validare_task": "Rulează un script minimal care face `SELECT 1` prin clientul Drizzle și pool-ul pg. Confirmă că pool-ul și drizzle partajează aceeași conexiune.",
        "outcome_task": "Pachetul `@app/database` poate executa interogări prin Drizzle ȘI streaming COPY prin pg-copy-streams, cu un singur pool.",
        "restrictii_antihalucinatie": "NU instala driverul `postgres` (postgres-js) - nu suportă pg-copy-streams. NU crea două pool-uri separate. NU hardcoda URL-uri."
    },

    {
        "id_task": "F2.1.2",
        "denumire_task": "Configurare drizzle-kit și pipeline de migrații SQL",
        "descriere_task": "Adaugă `drizzle-kit` ca devDependency în `packages/database` și configurează `drizzle.config.ts` (dialect postgres, paths pentru schema și migrations). Definește scripturi: `db:generate`, `db:migrate`.",
        "cale_implementare": "/Neanelu_Shopify/packages/database/drizzle.config.ts și scripts root",
        "contextul_anterior": "Drizzle ORM este configurat; lipsește mecanismul de migrații controlate.",
        "validare_task": "Generează o migrație de test și rulează migrarea pe Postgres local. Verifică existența tabelului de migrații și aplicarea fără erori.",
        "outcome_task": "Proiectul are un flux standard de migrații prin drizzle-kit.",
        "restrictii_antihalucinatie": "Migrațiile SQL rămân sursa de adevăr. Nu folosi migrații auto-aplicate în runtime."
    }
    ]
    ```

    ```JSON
    [
    {
        "id_task": "F2.1.2.1",
        "denumire_task": "Activare extensii PostgreSQL baseline (pgcrypto, citext, pg_trgm, pgvector)",
        "descriere_task": "**Enterprise DB Setup:** Prima migrație trebuie să activeze extensiile necesare:\n\n**Migrație SQL (0000_enable_extensions.sql):**\n```sql\n-- Extensii necesare pentru schema și performanță\n-- NOTĂ: UUIDv7 este nativ în PG18 (uuidv7()), nu necesită extensie ossp\nCREATE EXTENSION IF NOT EXISTS \"pgcrypto\";\nCREATE EXTENSION IF NOT EXISTS \"citext\";\nCREATE EXTENSION IF NOT EXISTS \"pg_trgm\";\nCREATE EXTENSION IF NOT EXISTS \"btree_gin\";\n-- Extensie pentru vector search și deduplicare semantică (redistribuit din F8.3.1)\nCREATE EXTENSION IF NOT EXISTS \"vector\";\n```\n\n**Decizie partitionare (documentează explicit):**\n- Pentru 1M+ SKU, partitionarea după `shop_id` crește performanța\n- Dacă NU partiționezi, documentează motivul",
        "cale_implementare": "/Neanelu_Shopify/packages/database/drizzle/migrations/0000_enable_extensions.sql",
        "contextul_anterior": "drizzle-kit este configurat. Extensiile trebuie activate ÎNAINTE de schema.",
        "validare_task": "Rulează `SELECT extname FROM pg_extension;` și confirmă prezența extensiilor (inclusiv 'vector').",
        "outcome_task": "PostgreSQL are extensiile necesare pentru UUIDv7, criptare, indexing și vector search.",
        "restrictii_antihalucinatie": "NU sări peste acest pas - schema va eșua fără pgcrypto (pentru auth). pgvector este OBLIGATORIU pentru F2.2.7 (schema vectorială)."
    },

    {
        "id_task": "F2.1.2.2",
        "denumire_task": "Definire roluri DB și privilegii (bootstrap privilegiat, NU migrație drizzle)",
        "descriere_task": "**IMPORTANT: Acesta NU este un pas drizzle-kit!**\n\n**Decizie simplificare:** un singur owner pentru DB/tabele + un singur URL de migrare (DATABASE_URL).\n\n**Script bootstrap (scripts/db-bootstrap.sh):**\n```bash\n#!/bin/bash\n# Rulează O SINGURĂ DATĂ per mediu cu credentiale superuser\nexport PGPASSWORD=\"$POSTGRES_SUPERUSER_PASSWORD\"\n\npsql -h \"$DB_HOST\" -U postgres -d \"$DB_NAME\" <<SQL\nALTER DATABASE $DB_NAME OWNER TO $POSTGRES_USER;\nDO $$\nDECLARE r RECORD;\nBEGIN\n  FOR r IN SELECT format('%I.%I', schemaname, tablename) AS fqtn\n           FROM pg_tables\n          WHERE schemaname = 'public'\n  LOOP\n    EXECUTE 'ALTER TABLE ' || r.fqtn || ' OWNER TO $POSTGRES_USER';\n  END LOOP;\nEND$$;\nSQL\n```\n\n**Environment variables:**\n- `DATABASE_URL` - user owner (un singur URL pentru runtime + migrații)",
        "cale_implementare": "/Neanelu_Shopify/scripts/db-bootstrap.sh",
        "contextul_anterior": "Extensiile sunt activate. Bootstrap-ul se rulează O DATĂ per mediu.",
        "validare_task": "Conectează-te cu userul owner și verifică că owner-ul este uniform pentru DB și toate tabelele din schema public.",
        "outcome_task": "Owner unic pentru DB/tabele și un singur URL de migrare (DATABASE_URL).",
        "restrictii_antihalucinatie": "NU pune acest script în migrații drizzle. NU comite parole. Script-ul se rulează MANUAL sau din CI."
    }
    ]
    ```

### F2.2: Definirea schemelor și migrații inițiale (incl. RLS pentru multi-tenant)

    ```JSON
    [
    {
        "id_task": "F2.2.1",
        "denumire_task": "Definire schema inițială (shops, products, tokens, jobs) cu UUIDv7 nativ",
        "descriere_task": "Definește tabelele inițiale cu structură enterprise și UUIDv7 nativ PostgreSQL 18:\n\n**STANDARD UUIDv7 (PostgreSQL 18 nativ):**\n- Tipul coloanei: `uuid` (tipul standard Postgres)\n- Funcția de generare: `uuidv7()` (nou în PG18, time-ordered)\n- Cast: `::uuid` (nu ::UUIDv7 - tipul e tot uuid)\n\n**shops:**\n- id uuid PRIMARY KEY DEFAULT uuidv7()\n- shopify_domain citext UNIQUE\n- name, email, plan\n- created_at, updated_at\n\n**products:**\n- id uuid PRIMARY KEY DEFAULT uuidv7()\n- shop_id uuid REFERENCES shops(id)\n- shopify_id bigint\n- title, handle citext\n- metafields jsonb\n- created_at, updated_at\n\n**shopify_tokens (criptare AEAD):**\n- id uuid PRIMARY KEY DEFAULT uuidv7()\n- shop_id uuid UNIQUE REFERENCES shops(id)\n- access_token_ciphertext bytea\n- access_token_iv bytea (12 bytes AES-GCM)\n- access_token_tag bytea (16 bytes auth tag)\n- key_version int\n- scopes text[]\n- created_at, rotated_at\n\n**bulk_runs:**\n- id uuid PRIMARY KEY DEFAULT uuidv7()\n- shop_id uuid REFERENCES shops(id)\n- status text CHECK (status IN ('pending', 'running', 'polling', 'downloading', 'processing', 'completed', 'failed', 'cancelled'))\n- started_at, completed_at\n- records_processed int\n\n**Indexuri și constraints (CONFORM Strategie_dezvoltare.md):**\n```sql\n-- UNIQUE constraint: shopify_id unic per shop\nCREATE UNIQUE INDEX idx_products_shop_shopify_id ON products(shop_id, shopify_id);\nCREATE INDEX idx_products_shop_id ON products(shop_id);\nCREATE INDEX idx_products_metafields ON products USING GIN(metafields);\nCREATE INDEX idx_products_title_trgm ON products USING GIN(title gin_trgm_ops);\n```",
        "cale_implementare": "/Neanelu_Shopify/packages/database/src/schema.ts + migrații SQL",
        "contextul_anterior": "Extensiile și rolurile sunt create. PostgreSQL 18.1 cu uuidv7() nativ.",
        "validare_task": "Rulează `db:migrate` și verifică:\n1. SELECT uuidv7() returnează UUID valid\n2. UNIQUE constraint pe (shop_id, shopify_id) funcționează\n3. Toate PK-urile folosesc DEFAULT uuidv7()",
        "outcome_task": "Schema completă cu UUIDv7 nativ pentru toate ID-urile, UNIQUE constraint, și indexuri.",
        "restrictii_antihalucinatie": "NU folosi gen_random_uuid() pentru PK - folosește uuidv7() pentru time-ordering. NU folosi tip 'UUIDv7' - tipul e 'uuid'. NU omite UNIQUE (shop_id, shopify_id)."
    },

    {
        "id_task": "F2.2.2",
        "denumire_task": "Activare RLS + politici tenant_isolation COMPLETE (toate tabelele)",
        "descriere_task": "**RLS Hardening complet - TOATE tabelele multi-tenant:**\n\n**Migrație SQL (xxx_enable_rls.sql):**\n```sql\n-- Activare RLS pe TOATE tabelele multi-tenant\n-- Regulă de aur: Orice tabel nou multi-tenant creat ulterior (ex: în F5) TREBUIE să aibă ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY și politica tenant_isolation.\nALTER TABLE products ENABLE ROW LEVEL SECURITY;\nALTER TABLE shopify_tokens ENABLE ROW LEVEL SECURITY;\nALTER TABLE bulk_runs ENABLE ROW LEVEL SECURITY;\n\n-- FORCE RLS pentru a preveni bypass-ul de către owner\nALTER TABLE products FORCE ROW LEVEL SECURITY;\nALTER TABLE shopify_tokens FORCE ROW LEVEL SECURITY;\nALTER TABLE bulk_runs FORCE ROW LEVEL SECURITY;\n\n-- POLITICI COMPLETE pentru FIECARE tabel\n-- NOTĂ: Cast-ul e ::uuid (tipul standard), NU ::UUIDv7\nCREATE POLICY tenant_isolation_products ON products\n  FOR ALL TO app_runtime\n  USING (shop_id = COALESCE(current_setting('app.current_shop_id', true)::uuid, '00000000-0000-0000-0000-000000000000'::uuid));\n\nCREATE POLICY tenant_isolation_tokens ON shopify_tokens\n  FOR ALL TO app_runtime\n  USING (shop_id = COALESCE(current_setting('app.current_shop_id', true)::uuid, '00000000-0000-0000-0000-000000000000'::uuid));\n\nCREATE POLICY tenant_isolation_bulk_runs ON bulk_runs\n  FOR ALL TO app_runtime\n  USING (shop_id = COALESCE(current_setting('app.current_shop_id', true)::uuid, '00000000-0000-0000-0000-000000000000'::uuid));\n```\n\n**IMPORTANT:** Fără policy, RLS activat = deny-all implicit!\n\n**Decizie fail-safe:** 0 rânduri când context lipsește (stabilitate > strictețe).",
        "cale_implementare": "/Neanelu_Shopify/packages/database/drizzle/migrations/*.sql",
        "contextul_anterior": "Schema există cu uuid type. RLS folosește cast ::uuid.",
        "validare_task": "Testează FIECARE tabel:\n1. products: query fără context → 0 rânduri\n2. shopify_tokens: query fără context → 0 rânduri\n3. bulk_runs: query fără context → 0 rânduri\n4. Cu context valid → datele corecte",
        "outcome_task": "RLS activ pe TOATE tabelele cu politici complete și cast corect ::uuid.",
        "restrictii_antihalucinatie": "NU folosi ::UUIDv7 în cast - tipul e 'uuid'. NU uita policy pentru fiecare tabel."
    },

    {
        "id_task": "F2.2.3",
        "denumire_task": "Disciplina conexiunilor: SET LOCAL per tranzacție",
        "descriere_task": "Implementează un guard/middleware în `@app/database` care, la fiecare request/worker job, deschide tranzacție și emite `SET LOCAL app.current_shop_id = $shopId::uuid` înainte de orice query.\n\n**NOTĂ:** Cast-ul e `::uuid`, NU `::UUIDv7` - tipul PostgreSQL e 'uuid'.",
        "cale_implementare": "/Neanelu_Shopify/packages/database/src/middleware/session-guard.ts",
        "contextul_anterior": "RLS există; fără disciplina conexiunilor, pool-ul poate provoca leak de context.",
        "validare_task": "Adaugă un test de integrare: două operații consecutive cu shop-uri diferite nu trebuie să vadă datele celuilalt.",
        "outcome_task": "Contextul tenant este setat corect și sigur cu pooling, folosind cast ::uuid.",
        "restrictii_antihalucinatie": "Nu seta global pe conexiune; folosește tranzacții + SET LOCAL. Cast e ::uuid, NU ::UUIDv7."
    },

    {
        "id_task": "F2.2.3.2",
        "denumire_task": "Procedură rotație chei criptare (key rotation) pentru shopify_tokens",
        "descriere_task": "**Implementează procedura de rotație a cheilor de criptare:**\n\n**1. Structura cheilor:**\n```typescript\n// packages/database/src/encryption/keys.ts\ninterface EncryptionKey {\n  version: number;\n  key: Buffer; // 256 biți (32 bytes)\n  createdAt: Date;\n  deprecated: boolean; // true = nu mai cripta cu aceasta\n}\n\n// Cheile se încarcă din secret manager, NU hardcodate\nconst ACTIVE_KEY_VERSION = parseInt(process.env.ENCRYPTION_KEY_VERSION || '1');\nconst KEYS: Map<number, EncryptionKey> = loadKeysFromSecretManager();\n```\n\n**2. Decriptare cu backward compatibility:**\n```typescript\nfunction decryptToken(row: ShopifyTokenRow): string {\n  const key = KEYS.get(row.key_version);\n  if (!key) throw new Error(`Unknown key version: ${row.key_version}`);\n  return aesGcmDecrypt(row.ciphertext, key.key, row.iv, row.tag);\n}\n```\n\n**3. Script de rotație:**\n```bash\n# scripts/rotate-encryption-key.ts\n# Rulează O DATĂ când se adaugă cheie nouă\n# Re-criptează toate token-urile cu noua cheie\n```\n\n**4. Environment variables:**\n- `ENCRYPTION_KEY_V1` - prima cheie (se păstrează pentru decriptare veche)\n- `ENCRYPTION_KEY_V2` - noua cheie (se folosește pentru criptare nouă)\n- `ENCRYPTION_KEY_VERSION=2` - versiunea activă pentru criptare",
        "cale_implementare": "/Neanelu_Shopify/packages/database/src/encryption/",
        "contextul_anterior": "Schema are key_version în shopify_tokens. Lipsește procedura de rotație.",
        "validare_task": "1. Criptează un token cu V1\n2. Schimbă ENCRYPTION_KEY_VERSION la 2\n3. Decriptarea tokenului V1 funcționează (backward compat)\n4. Criptare nouă folosește V2",
        "outcome_task": "Rotația cheilor funcționează fără downtime, cu backward compatibility.",
        "restrictii_antihalucinatie": "NU șterge niciodată cheile vechi până când toate token-urile sunt re-criptate. NU hardcoda cheile în cod."
    },

    {
        "id_task": "F2.2.3.1",
        "denumire_task": "Strategie migrații DevOps (rollback, concurență, multi-env)",
        "descriere_task": "**Definește strategia de migrații pentru producție:**\n\n**1. Strategie de rollback (documentată explicit):**\n- **Forward-only cu migrații compensatorii** (recomandat pentru schema critică)\n- SAU down-migrations (mai complex, risc de pierdere date)\n- DOCUMENTEAZĂ alegerea în README packages/database\n\n**2. Migrații pe medii (dev/staging/prod):**\n- DEV: `db:migrate` rulat local\n- CI: `db:migrate` rulat în job-ul de test cu Postgres ephemeral\n- STAGING/PROD: `db:migrate` rulat în pipeline deploy ÎNAINTE de deploy app\n\n**3. Blocare concurentă (advisory lock):**\n```typescript\n// În migration runner\nconst MIGRATION_LOCK_ID = 12345;\nawait sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID})`;\n// ... run migrations\nawait sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`;\n```\n\n**4. Script CI pentru migrații:**\n```yaml\n# În .github/workflows/deploy.yml\n- name: Run migrations\n  run: pnpm run db:migrate\n  env:\n    DATABASE_URL: ${{ secrets.DATABASE_URL }}\n```",
        "cale_implementare": "/Neanelu_Shopify/packages/database/README.md + scripts",
        "contextul_anterior": "Migrațiile există dar nu e clar cum se aplică pe medii și cum se gestionează rollback.",
        "validare_task": "Documentația packages/database/README.md conține: strategia de rollback, fluxul per mediu, și comportamentul în CI. Advisory lock funcționează: două procese de migrare simultane nu corup schema.",
        "outcome_task": "Strategie de migrații clară și sigură pentru multi-env și CI/CD.",
        "restrictii_antihalucinatie": "NU lăsa migrațiile să ruleze automat la startup app fără lock. NU presupune că toți știu strategia - DOCUMENTEAZĂ explicit."
    },

    {
        "id_task": "F2.2.4",
        "denumire_task": "Test de integrare RLS (CI-ready cu Postgres ephemeral)",
        "descriere_task": "**Adaugă test explicit pentru RLS în CI:**\n\n**Test file: packages/database/src/__tests__/rls.test.ts**\n```typescript\nimport { describe, it, before, after } from 'node:test';\nimport assert from 'node:assert';\nimport { pool, withShopContext } from '../db';\n\ndescribe('RLS tenant isolation', () => {\n  const shopA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';\n  const shopB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';\n\n  before(async () => {\n    // Setup: create test shops and products\n  });\n\n  it('should not leak data between tenants', async () => {\n    const productsA = await withShopContext(shopA, () => \n      db.select().from(products)\n    );\n    const productsB = await withShopContext(shopB, () => \n      db.select().from(products)\n    );\n    \n    assert.ok(productsA.every(p => p.shopId === shopA));\n    assert.ok(productsB.every(p => p.shopId === shopB));\n  });\n\n  it('should return 0 rows without context set', async () => {\n    const result = await pool.query('SELECT * FROM products');\n    assert.strictEqual(result.rows.length, 0);\n  });\n});\n```\n\n**CI integration:**\n- Rulează cu Postgres ephemeral din F1.4 (services: postgres:18.1)\n- Script: `pnpm --filter @app/database run test`",
        "cale_implementare": "/Neanelu_Shopify/packages/database/src/__tests__/rls.test.ts",
        "contextul_anterior": "RLS este activat dar nu există test automat în CI care să valideze izolarea.",
        "validare_task": "Rulează `pnpm --filter @app/database run test` local și în CI. Testele trec. Modifică intenționat politica RLS și confirmă că testele eșuează.",
        "outcome_task": "Test automat în CI garantează că RLS nu regresează.",
        "restrictii_antihalucinatie": "NU sări peste acest test - este singura garanție automată de izolare. NU presupune că RLS funcționează doar pentru că l-ai activat."
    ]
    ```

### F2.2.4.x: Audit Trail Schema (CONFORM Problems & Fixes.md)

> [!IMPORTANT]
> **PRIORITATE P0 - ÎNAINTE DE F3:** Aceste task-uri adresează GAP 2.3 din auditul de observabilitate. Audit trail-ul este OBLIGATORIU pentru compliance și investigații de securitate.

    ```JSON
    {
        "id_task": "F2.2.4.1",
        "denumire_task": "Implementare tabela audit_logs cu schema completă și RLS",
        "descriere_task": "**CONFORM Problems & Fixes.md - Gap 2.3:** Creează tabela audit_logs pentru tracking operațiuni sensibile:\n\n**Schema SQL:**\n```sql\nCREATE TABLE audit_logs (\n  id uuid PRIMARY KEY DEFAULT uuidv7(),\n  timestamp timestamptz DEFAULT now(),\n  action text NOT NULL CHECK (action IN (\n    'oauth_login_success', 'oauth_login_failed', 'oauth_token_refresh',\n    'bulk_operation_started', 'bulk_operation_completed', 'bulk_operation_failed',\n    'key_rotation_initiated', 'key_rotation_completed',\n    'rate_limit_changed', 'config_changed',\n    'data_export_requested', 'admin_action'\n  )),\n  actor_type text CHECK (actor_type IN ('user', 'system', 'scheduler', 'webhook')),\n  actor_id uuid,\n  shop_id uuid REFERENCES shops(id),\n  resource_type text,\n  resource_id uuid,\n  details jsonb NOT NULL DEFAULT '{}',\n  ip_address inet,\n  user_agent text,\n  trace_id text,\n  span_id text\n);\n\nCREATE INDEX idx_audit_logs_shop_timestamp ON audit_logs(shop_id, timestamp DESC);\nCREATE INDEX idx_audit_logs_action ON audit_logs(action);\nCREATE INDEX idx_audit_logs_trace ON audit_logs(trace_id) WHERE trace_id IS NOT NULL;\n\nALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;\nALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation_audit_logs ON audit_logs\n  FOR ALL TO app_runtime\n  USING (shop_id = COALESCE(current_setting('app.current_shop_id', true)::uuid, '00000000-0000-0000-0000-000000000000'::uuid));\n```\n\n**Funcție helper pentru logging:**\n```typescript\n// packages/database/src/audit.ts\nexport async function logAuditEvent(\n  action: AuditAction,\n  context: AuditContext\n): Promise<void> {\n  await db.insert(auditLogs).values({\n    action,\n    actorType: context.actorType,\n    actorId: context.actorId,\n    shopId: context.shopId,\n    resourceType: context.resourceType,\n    resourceId: context.resourceId,\n    details: context.details,\n    ipAddress: context.ip,\n    userAgent: context.userAgent,\n    traceId: context.traceId,\n    spanId: context.spanId\n  });\n}\n```",
        "cale_implementare": "/Neanelu_Shopify/packages/database/src/schema/audit.ts + migrații SQL",
        "contextul_anterior": "F2.2.4 definește testele RLS. Acesta extinde schema cu audit trail necesar pentru compliance și debugging.",
        "validare_task": "1. Migrația rulează fără erori\n2. INSERT în audit_logs funcționează cu toate action types\n3. RLS filtrează corect per shop_id\n4. Indexurile sunt create (verify cu \\di)",
        "outcome_task": "Audit trail operațional pentru toate acțiunile sensibile, cu RLS și indexuri pentru căutare rapidă.",
        "restrictii_antihalucinatie": "NU omite RLS și FORCE RLS. NU hardcoda action types - folosește CHECK constraint. Trace_id și span_id sunt opționale."
    }
    ```

### F2.2.x: Schema PIM Core și Vectori (redistribuit din F8)

> [!NOTE]
> **Redistribuire F8:** Următoarele task-uri (F2.2.5-F2.2.7) au fost mutate din Faza F8 pentru a corecta cronologia. Schema PIM este PREREQUISITE pentru ingestia corectă în F5 și pentru deduplicarea semantică în F6.

    ```JSON
    [
    {
        "id_task": "F2.2.5",
        "denumire_task": "Schema PIM Core: prod_taxonomy + prod_raw_harvest + prod_core + prod_specs_normalized (redistribuit din F8.2.1)",
        "descriere_task": "**MUTAT din F8.2.1 - PREREQUISITE pentru F5 (Bulk Ops) și F6 (AI)**\n\nImplementează structura stratificată PIM (4-Layer Architecture):\n\n**1. Governance Layer (prod_taxonomy):**\n```sql\nCREATE TABLE prod_taxonomy (\n  id uuid PRIMARY KEY DEFAULT uuidv7(),\n  parent_id uuid REFERENCES prod_taxonomy(id),\n  name text NOT NULL,\n  attribute_schema jsonb NOT NULL DEFAULT '{}',\n  shopify_taxonomy_id text,\n  created_at timestamptz DEFAULT now(),\n  updated_at timestamptz DEFAULT now()\n);\nCREATE INDEX idx_prod_taxonomy_parent ON prod_taxonomy(parent_id);\nCREATE UNIQUE INDEX idx_prod_taxonomy_shopify_id ON prod_taxonomy(shopify_taxonomy_id) WHERE shopify_taxonomy_id IS NOT NULL;\n```\n\n**2. Raw Ingestion Layer (prod_raw_harvest):**\n```sql\nCREATE TABLE prod_raw_harvest (\n  id uuid PRIMARY KEY DEFAULT uuidv7(),\n  source_url text NOT NULL,\n  source_type text NOT NULL CHECK (source_type IN ('scraping', 'api', 'manual', 'bulk_import')),\n  raw_content text,\n  raw_html text,\n  content_hash text,\n  fetched_at timestamptz DEFAULT now(),\n  processed boolean DEFAULT false\n);\nCREATE INDEX idx_prod_raw_harvest_content_hash ON prod_raw_harvest(content_hash);\nCREATE INDEX idx_prod_raw_harvest_processed ON prod_raw_harvest(processed) WHERE processed = false;\n```\n\n**3. Process Layer (prod_extraction_sessions):**\n```sql\nCREATE TABLE prod_extraction_sessions (\n  id uuid PRIMARY KEY DEFAULT uuidv7(),\n  harvest_id uuid REFERENCES prod_raw_harvest(id) ON DELETE CASCADE,\n  extracted_data jsonb NOT NULL,\n  ai_model text,\n  confidence_score float,\n  created_at timestamptz DEFAULT now()\n);\nCREATE INDEX idx_prod_extraction_sessions_harvest ON prod_extraction_sessions(harvest_id);\n```\n\n**4. Golden Record Layer (prod_core + prod_specs_normalized):**\n```sql\nCREATE TABLE prod_core (\n  id uuid PRIMARY KEY DEFAULT uuidv7(),\n  internal_sku text UNIQUE,\n  canonical_title text NOT NULL,\n  brand text,\n  taxonomy_id uuid REFERENCES prod_taxonomy(id),\n  dedupe_status text DEFAULT 'unique' CHECK (dedupe_status IN ('unique', 'merged', 'suspicious')),\n  created_at timestamptz DEFAULT now(),\n  updated_at timestamptz DEFAULT now()\n);\nCREATE INDEX idx_prod_core_brand ON prod_core(brand);\nCREATE INDEX idx_prod_core_taxonomy ON prod_core(taxonomy_id);\n\nCREATE TABLE prod_specs_normalized (\n  id uuid PRIMARY KEY DEFAULT uuidv7(),\n  product_id uuid REFERENCES prod_core(id) ON DELETE CASCADE,\n  specs jsonb NOT NULL DEFAULT '{}',\n  provenance jsonb NOT NULL DEFAULT '{}',\n  needs_review boolean DEFAULT false,\n  version int DEFAULT 1,\n  created_at timestamptz DEFAULT now()\n);\nCREATE INDEX idx_prod_specs_normalized_specs ON prod_specs_normalized USING GIN(specs);\nCREATE INDEX idx_prod_specs_normalized_product ON prod_specs_normalized(product_id);\n```\n\n**5. Link PIM → Shopify (prod_channel_mappings):**\n```sql\nCREATE TABLE prod_channel_mappings (\n  id uuid PRIMARY KEY DEFAULT uuidv7(),\n  core_id uuid REFERENCES prod_core(id) ON DELETE CASCADE,\n  channel_type text NOT NULL DEFAULT 'shopify',\n  channel_product_id uuid REFERENCES products(id),\n  shopify_gid text,\n  sync_status text CHECK (sync_status IN ('pending', 'synced', 'error', 'manual')),\n  last_synced_at timestamptz,\n  created_at timestamptz DEFAULT now()\n);\nCREATE INDEX idx_prod_channel_mappings_core ON prod_channel_mappings(core_id);\nCREATE INDEX idx_prod_channel_mappings_channel ON prod_channel_mappings(channel_product_id);\n```\n\n**NOTĂ ARHITECTURALĂ:** Aceste tabele NU au RLS deoarece reprezintă PIM global (nu per-tenant). Relația 1:N între prod_core (produs global) și products (produs per-shop) este gestionată prin prod_channel_mappings.",
        "cale_implementare": "/Neanelu_Shopify/packages/database/src/schema/pim.ts + migrații SQL",
        "contextul_anterior": "F2.2.1-F2.2.4 definesc schema Shopify Mirror. PIM layer este SURSA de date pentru Shopify products.",
        "validare_task": "Migrațiile rulează fără erori. Toate tabelele create. FK-uri valide. Indexurile GIN funcționează pe prod_specs_normalized.",
        "outcome_task": "Schema PIM 4-layer completă, pregătită pentru ingestie în F5 și AI în F6.",
        "restrictii_antihalucinatie": "NU sări peste acest pas - F5/F6 depind de existența acestei scheme. NU adăuga RLS fără decizie explicită de multi-tenancy pentru PIM."
    },

    {
        "id_task": "F2.2.6",
        "denumire_task": "Import Shopify Standard Taxonomy în prod_taxonomy (redistribuit din F8.2.2)",
        "descriere_task": "**MUTAT din F8.2.2 - PREREQUISITE pentru validare în F5**\n\nImportă taxonomia oficială Shopify în tabelul prod_taxonomy:\n\n**1. Sursa de date:**\n- GitHub: https://github.com/Shopify/product-taxonomy (JSON/YAML)\n- API Admin GraphQL: `shopProductTaxonomyNode` (opțional, pentru sync live)\n\n**2. Script de import:**\n```typescript\n// packages/database/src/seed/taxonomy.ts\nimport { db } from '../db';\nimport { prodTaxonomy } from '../schema/pim';\n\nconst TAXONOMY_URL = 'https://raw.githubusercontent.com/Shopify/product-taxonomy/main/data/verticals.json';\n\nexport async function seedTaxonomy() {\n  const response = await fetch(TAXONOMY_URL);\n  const data = await response.json();\n  \n  // Procesare recursivă pentru structura arborescentă\n  async function insertCategory(category: any, parentId: string | null = null) {\n    const [inserted] = await db.insert(prodTaxonomy).values({\n      name: category.name,\n      parentId,\n      attributeSchema: category.attributes || {},\n      shopifyTaxonomyId: category.id,\n    }).onConflictDoUpdate({\n      target: prodTaxonomy.shopifyTaxonomyId,\n      set: { name: category.name, attributeSchema: category.attributes, updatedAt: new Date() }\n    }).returning();\n    \n    for (const child of category.children || []) {\n      await insertCategory(child, inserted.id);\n    }\n  }\n  \n  for (const vertical of data.verticals) {\n    await insertCategory(vertical);\n  }\n}\n```\n\n**3. Scripts în package.json:**\n- `db:seed:taxonomy` - import complet\n- `db:seed:taxonomy:update` - update incremental (doar categorii modificate)\n\n**4. Validare la runtime (pentru F5):**\nProdusele ingestionate pot fi validate contra attribute_schema din prod_taxonomy.",
        "cale_implementare": "/Neanelu_Shopify/packages/database/src/seed/taxonomy.ts",
        "contextul_anterior": "F2.2.5 a creat tabelul prod_taxonomy. Acum îl populăm cu date oficiale Shopify.",
        "validare_task": "Rulează `pnpm run db:seed:taxonomy`. Verifică:\n1. COUNT(*) FROM prod_taxonomy > 0\n2. Structura arborescentă: SELECT * FROM prod_taxonomy WHERE parent_id IS NOT NULL\n3. attribute_schema populated pentru categorii principale",
        "outcome_task": "Taxonomia Shopify importată, gata pentru validare în F5 și mapping în F6.",
        "restrictii_antihalucinatie": "NU hardcoda categorii - folosește sursa oficială Shopify. NU sări peste acest pas dacă F5 va valida structura produselor."
    },

    {
        "id_task": "F2.2.7",
        "denumire_task": "Schema pgvector: prod_attr_registry + prod_embeddings pentru deduplicare semantică (redistribuit din F8.3.1)",
        "descriere_task": "**MUTAT din F8.3.1 - PREREQUISITE pentru deduplicare în F5/F6**\n\n**DECIZIE ARHITECTURALĂ (2025):**\n- **pgvector (Postgres):** SOLE VECTOR STORAGE. Nu folosim Redis pentru vectori (doar cache results/limits).\n- **Index Strategy:** HNSW pentru performanță (<10ms latency pentru milioane de vectori).\n\nImplementează registry-ul de atribute și embeddings cu suport vector:\n\n**1. Atributele canonice cu embeddings:**\n```sql\nCREATE TABLE prod_attr_registry (\n  id uuid PRIMARY KEY DEFAULT uuidv7(),\n  code text UNIQUE NOT NULL,\n  label text NOT NULL,\n  data_type text CHECK (data_type IN ('string', 'number', 'boolean', 'array', 'object')),\n  unit text,\n  embedding vector(1536), -- OpenAI text-embedding-3-small (1536 dims)\n  created_at timestamptz DEFAULT now(),\n  updated_at timestamptz DEFAULT now()\n);\n\n-- Index HNSW pentru căutare vectorială rapidă\n-- m=16, ef_construction=64 sunt valori bune pentru <100K atribute\nCREATE INDEX idx_prod_attr_registry_embedding ON prod_attr_registry \n  USING hnsw (embedding vector_cosine_ops)\n  WITH (m = 16, ef_construction = 64);\n```\n\n**2. Dicționarul de sinonime:**\n```sql\nCREATE TABLE prod_attr_synonyms (\n  id uuid PRIMARY KEY DEFAULT uuidv7(),\n  synonym text NOT NULL UNIQUE,\n  registry_id uuid REFERENCES prod_attr_registry(id) ON DELETE CASCADE,\n  confidence float CHECK (confidence >= 0 AND confidence <= 1),\n  source text CHECK (source IN ('manual', 'ai_detected', 'bulk_import')),\n  created_at timestamptz DEFAULT now()\n);\nCREATE INDEX idx_prod_attr_synonyms_registry ON prod_attr_synonyms(registry_id);\nCREATE INDEX idx_prod_attr_synonyms_synonym ON prod_attr_synonyms USING gin(synonym gin_trgm_ops);\n```\n\n**3. Embeddings pentru produse (deduplicare fuzzy):**\n```sql\nCREATE TABLE prod_embeddings (\n  id uuid PRIMARY KEY DEFAULT uuidv7(),\n  product_id uuid REFERENCES prod_core(id) ON DELETE CASCADE,\n  embedding_type text CHECK (embedding_type IN ('title', 'description', 'full', 'title_brand')),\n  embedding vector(1536),\n  content_hash text NOT NULL,\n  model text DEFAULT 'text-embedding-3-small',\n  created_at timestamptz DEFAULT now(),\n  UNIQUE(product_id, embedding_type)\n);\n\n-- Index HNSW pentru deduplicare fuzzy\n-- m=32, ef_construction=128 pentru >1M produse (high quality index)\nCREATE INDEX idx_prod_embeddings_vector ON prod_embeddings \n  USING hnsw (embedding vector_cosine_ops)\n  WITH (m = 32, ef_construction = 128);\n\nCREATE INDEX idx_prod_embeddings_content_hash ON prod_embeddings(content_hash);\n```\n\n**4. Funcții helper pentru căutare vectorială rapidă (Direct DB):**\n```sql\n-- Funcție cu limitare CPU-bound pentru search\nCREATE OR REPLACE FUNCTION find_similar_products(\n  query_embedding vector(1536),\n  similarity_threshold float DEFAULT 0.95,\n  max_results int DEFAULT 10\n)\nRETURNS TABLE (product_id uuid, similarity float) AS $$\n  SELECT e.product_id, 1 - (e.embedding <=> query_embedding) as similarity\n  FROM prod_embeddings e\n  WHERE e.embedding_type = 'title_brand'\n    AND e.embedding <=> query_embedding < (1 - similarity_threshold)\n  ORDER BY e.embedding <=> query_embedding\n  LIMIT max_results;\n$$ LANGUAGE SQL STABLE;\n```",
        "cale_implementare": "/Neanelu_Shopify/packages/database/src/schema/vectors.ts + migrații SQL",
        "contextul_anterior": "F2.1.2.1 a activat extensia pgvector. F2.2.5 a creat prod_core. Acum creăm schema optimizată HNSW.",
        "validare_task": "Migrațiile rulează. Teste:\n1. INSERT un vector de test în prod_attr_registry\n2. Query HNSW returnează rezultate ordonate și rapide (EXPLAIN confirmă index Scan).\n3. find_similar_products() funcționează corect.",
        "outcome_task": "Schema vectorială unificată în Postgres, fără necesitate de Redis vector store.",
        "restrictii_antihalucinatie": "NU omite indexul HNSW - este critic pentru pgvector-only. NU include coloane pentru sync status (nu mai avem sync)."
    ]
    ```

### F2.2.8.x: Database Schema Completions (CONFORM Problems & Fixes.md Audit)

> [!IMPORTANT]
> **PRIORITATE P0/P1 - ÎNAINTE DE F3/F4:** Aceste task-uri adresează GAP-urile identificate în auditul de schema din Problems & Fixes.md. Tabelele OAuth și webhook sunt PREREQUISITE pentru F3.2/F3.3.

    ```JSON
    [
    {
        "id_task": "F2.2.8",
        "denumire_task": "Creare tabele OAuth (oauth_states, oauth_nonces) pentru F3.2",
        "descriere_task": "Migrație SQL pentru tabele OAuth necesare F3.2 (CSRF protection + replay protection):\n\n**oauth_states:**\n```sql\nCREATE TABLE oauth_states (\n    id UUID PRIMARY KEY DEFAULT uuidv7(),\n    state VARCHAR(64) UNIQUE NOT NULL,\n    shop_domain CITEXT NOT NULL,\n    redirect_uri TEXT NOT NULL,\n    nonce VARCHAR(64) NOT NULL,\n    expires_at TIMESTAMPTZ NOT NULL,\n    used_at TIMESTAMPTZ,\n    created_at TIMESTAMPTZ DEFAULT now()\n);\nCREATE INDEX idx_oauth_states_expires ON oauth_states(expires_at) WHERE used_at IS NULL;\n```\n\n**oauth_nonces:**\n```sql\nCREATE TABLE oauth_nonces (\n    id UUID PRIMARY KEY DEFAULT uuidv7(),\n    nonce VARCHAR(64) UNIQUE NOT NULL,\n    shop_id UUID REFERENCES shops(id),\n    used_at TIMESTAMPTZ,\n    expires_at TIMESTAMPTZ NOT NULL,\n    created_at TIMESTAMPTZ DEFAULT now()\n);\nCREATE INDEX idx_oauth_nonces_expires ON oauth_nonces(expires_at);\n```\n\n**RLS:** Nu necesită - date temporare pre-autentificare.",
        "cale_implementare": "/Neanelu_Shopify/packages/database/drizzle/migrations/0010_create_oauth_tables.sql",
        "contextul_anterior": "F2.2.1-F2.2.7 definesc schema inițială. OAuth tables sunt PREREQUISITE pentru F3.2.",
        "validare_task": "Migrația rulează fără erori. SELECT COUNT(*) FROM oauth_states returnează 0. Cleanup job poate șterge expired states.",
        "outcome_task": "Tabele OAuth pregătite pentru flow-ul de autentificare din F3.2.",
        "restrictii_antihalucinatie": "NU adăuga RLS pe oauth_states - sunt date pre-auth. NU omite TTL/cleanup logic."
    },
    {
        "id_task": "F2.2.9",
        "denumire_task": "Creare tabelă webhook_events cu partitioning lunar",
        "descriere_task": "Migrație SQL pentru webhook_events - tabelă partitionată pentru async webhook processing:\n\n```sql\nCREATE TABLE webhook_events (\n    id UUID DEFAULT uuidv7(),\n    shop_id UUID REFERENCES shops(id),\n    topic VARCHAR(100) NOT NULL,\n    shopify_webhook_id VARCHAR(100),\n    api_version VARCHAR(20),\n    payload JSONB NOT NULL,\n    hmac_verified BOOLEAN NOT NULL DEFAULT false,\n    received_at TIMESTAMPTZ DEFAULT now(),\n    processed_at TIMESTAMPTZ,\n    processing_error TEXT,\n    job_id VARCHAR(255),\n    idempotency_key VARCHAR(255),\n    retry_count INTEGER DEFAULT 0,\n    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),\n    PRIMARY KEY (id, created_at)\n) PARTITION BY RANGE (created_at);\n\nCREATE INDEX idx_webhook_events_unprocessed ON webhook_events(shop_id, received_at) WHERE processed_at IS NULL;\nCREATE INDEX idx_webhook_events_topic ON webhook_events(shop_id, topic);\nCREATE UNIQUE INDEX idx_webhook_events_idempotency ON webhook_events(idempotency_key) WHERE idempotency_key IS NOT NULL;\nCREATE INDEX idx_webhook_events_payload ON webhook_events USING GIN(payload jsonb_path_ops);\n\nALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;\nALTER TABLE webhook_events FORCE ROW LEVEL SECURITY;\nCREATE POLICY webhook_events_tenant_isolation ON webhook_events\n    USING (shop_id = current_setting('app.current_shop_id', true)::uuid);\n```",
        "cale_implementare": "/Neanelu_Shopify/packages/database/drizzle/migrations/0011_create_webhook_events.sql",
        "contextul_anterior": "F2.2.8 creează OAuth tables. Webhook events sunt PREREQUISITE pentru F3.3.",
        "validare_task": "Migrația rulează. Partițiile lunare sunt create. RLS filtrează corect per shop_id.",
        "outcome_task": "Webhook events table partitionată și cu RLS, pregătită pentru F3.3.",
        "restrictii_antihalucinatie": "NU omite partitioning - volum mare. NU omite RLS. Index GIN pe payload pentru debugging."
    },
    {
        "id_task": "F2.2.10",
        "denumire_task": "Creare tabele rate limiting (rate_limit_buckets, api_cost_tracking)",
        "descriere_task": "Migrații SQL pentru rate limiting distribuit (F4.3):\n\n**rate_limit_buckets:**\n```sql\nCREATE TABLE rate_limit_buckets (\n    shop_id UUID PRIMARY KEY REFERENCES shops(id),\n    tokens_remaining DECIMAL(10,2) NOT NULL DEFAULT 1000,\n    max_tokens DECIMAL(10,2) NOT NULL DEFAULT 1000,\n    refill_rate DECIMAL(10,4) NOT NULL DEFAULT 2.0,\n    last_refill_at TIMESTAMPTZ NOT NULL DEFAULT now(),\n    locked_until TIMESTAMPTZ,\n    consecutive_429_count INTEGER DEFAULT 0,\n    updated_at TIMESTAMPTZ DEFAULT now()\n);\n```\n\n**api_cost_tracking:**\n```sql\nCREATE TABLE api_cost_tracking (\n    id UUID DEFAULT uuidv7(),\n    shop_id UUID NOT NULL REFERENCES shops(id),\n    operation_type VARCHAR(50) NOT NULL,\n    query_hash VARCHAR(64),\n    actual_cost INTEGER NOT NULL,\n    throttle_status VARCHAR(20),\n    available_cost INTEGER,\n    restore_rate DECIMAL(10,2),\n    requested_at TIMESTAMPTZ DEFAULT now(),\n    response_time_ms INTEGER,\n    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),\n    PRIMARY KEY (id, created_at)\n) PARTITION BY RANGE (created_at);\n\nCREATE INDEX idx_api_cost_shop_date ON api_cost_tracking(shop_id, requested_at DESC);\nCREATE INDEX idx_api_cost_throttled ON api_cost_tracking(shop_id, throttle_status) WHERE throttle_status IS NOT NULL;\n```",
        "cale_implementare": "/Neanelu_Shopify/packages/database/drizzle/migrations/0012_create_rate_limit_tables.sql",
        "contextul_anterior": "F2.2.9 creează webhook_events. Rate limiting tables sunt PREREQUISITE pentru F4.3.",
        "validare_task": "Migrațiile rulează. Token bucket poate fi actualizat atomic. Partițiile sunt create.",
        "outcome_task": "Rate limiting tables pregătite pentru F4.3 cost-based throttling.",
        "restrictii_antihalucinatie": "NU omite partitioning pe api_cost_tracking. Retenție 7 zile recomandat."
    },
    {
        "id_task": "F2.2.11",
        "denumire_task": "Adăugare coloane lipsă în tabela shops",
        "descriere_task": "ALTER TABLE pentru coloane necesare în shops:\n\n```sql\nALTER TABLE shops ADD COLUMN IF NOT EXISTS shopify_shop_id BIGINT;\nALTER TABLE shops ADD COLUMN IF NOT EXISTS api_version VARCHAR(20) DEFAULT '2025-10';\nALTER TABLE shops ADD COLUMN IF NOT EXISTS webhook_secret BYTEA;\nALTER TABLE shops ADD COLUMN IF NOT EXISTS rate_limit_bucket INTEGER DEFAULT 1000;\nALTER TABLE shops ADD COLUMN IF NOT EXISTS last_api_call_at TIMESTAMPTZ;\nALTER TABLE shops ADD COLUMN IF NOT EXISTS shop_owner_email CITEXT;\nALTER TABLE shops ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'UTC';\nALTER TABLE shops ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) DEFAULT 'RON';\nALTER TABLE shops ADD COLUMN IF NOT EXISTS plan_limits JSONB DEFAULT '{}';\n\nCREATE INDEX IF NOT EXISTS idx_shops_shopify_id ON shops(shopify_shop_id) WHERE shopify_shop_id IS NOT NULL;\nALTER TABLE shops ADD CONSTRAINT chk_plan_tier CHECK (plan_tier IN ('basic', 'pro', 'enterprise'));\n```",
        "cale_implementare": "/Neanelu_Shopify/packages/database/drizzle/migrations/0013_alter_shops_add_columns.sql",
        "contextul_anterior": "F2.2.10 creează rate_limit_tables. Shops columns sunt necesare pentru webhook correlation și rate limiting.",
        "validare_task": "Migrația rulează. Toate coloanele există. CHECK constraint respinge valori invalide pentru plan_tier.",
        "outcome_task": "Tabela shops completă cu toate coloanele necesare pentru F3-F7.",
        "restrictii_antihalucinatie": "NU folosi UPDATE pentru coloane cu DEFAULT - IF NOT EXISTS gestionează migrația incrementală."
    },
    {
        "id_task": "F2.2.12",
        "denumire_task": "Adăugare coloane lipsă în tabela bulk_runs + index UNIQUE pentru lock",
        "descriere_task": "ALTER TABLE pentru bulk_runs + index critic pentru '1 bulk activ per shop':\n\n```sql\nALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS api_version VARCHAR(20);\nALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS polling_url TEXT;\nALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS result_url TEXT;\nALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS result_size_bytes BIGINT;\nALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS graphql_query_hash VARCHAR(64);\nALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES staff_users(id);\nALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;\nALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS cost_estimate INTEGER;\n\n-- INDEX CRITIC: Lock 1 bulk activ per shop\nCREATE UNIQUE INDEX IF NOT EXISTS idx_bulk_runs_active_shop \n    ON bulk_runs(shop_id) \n    WHERE status IN ('pending', 'running');\n\n-- CHECK constraint pentru status\nALTER TABLE bulk_runs ADD CONSTRAINT chk_bulk_status \n    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'));\n```",
        "cale_implementare": "/Neanelu_Shopify/packages/database/drizzle/migrations/0014_alter_bulk_runs.sql",
        "contextul_anterior": "F2.2.11 completează shops. Bulk_runs columns sunt necesare pentru F5.1 lock și tracking.",
        "validare_task": "Migrația rulează. INSERT al doilea bulk 'running' pentru același shop EȘUEAZĂ cu unique violation.",
        "outcome_task": "Bulk runs complet cu lock implicit pentru 1 operațiune activă per shop.",
        "restrictii_antihalucinatie": "NU omite UNIQUE INDEX partial - este CRITIC pentru prevenirea racing conditions în F5."
    },
    {
        "id_task": "F2.2.13",
        "denumire_task": "Creare trigger functions (update_updated_at, audit_critical_action)",
        "descriere_task": "Migrație SQL pentru trigger functions standard:\n\n```sql\n-- Auto-update updated_at\nCREATE OR REPLACE FUNCTION update_updated_at()\nRETURNS TRIGGER AS $$\nBEGIN\n    NEW.updated_at = now();\n    RETURN NEW;\nEND;\n$$ LANGUAGE plpgsql;\n\n-- Audit pentru acțiuni critice\nCREATE OR REPLACE FUNCTION audit_critical_action()\nRETURNS TRIGGER AS $$\nBEGIN\n    INSERT INTO audit_logs (shop_id, action, actor_type, resource_type, resource_id, details, trace_id)\n    VALUES (COALESCE(NEW.shop_id, OLD.shop_id), TG_ARGV[0], 'system', TG_TABLE_NAME,\n            COALESCE(NEW.id, OLD.id),\n            jsonb_build_object('operation', TG_OP, 'old', CASE WHEN TG_OP = 'DELETE' THEN row_to_json(OLD) ELSE NULL END,\n                              'new', CASE WHEN TG_OP != 'DELETE' THEN row_to_json(NEW) ELSE NULL END),\n            current_setting('app.trace_id', true));\n    RETURN COALESCE(NEW, OLD);\nEND;\n$$ LANGUAGE plpgsql;\n```",
        "cale_implementare": "/Neanelu_Shopify/packages/database/drizzle/migrations/0015_create_triggers.sql",
        "contextul_anterior": "F2.2.12 completează bulk_runs. Triggers asigură consistența datelor automat.",
        "validare_task": "Funcțiile există. UPDATE pe tabel cu trigger actualizează updated_at. Audit log insert funcționează.",
        "outcome_task": "Trigger functions pregătite pentru aplicare pe tabele.",
        "restrictii_antihalucinatie": "NU aplica triggers pe toate tabelele acum - doar definește funcțiile. Aplicarea vine incremental."
    },
    {
        "id_task": "F2.2.14",
        "denumire_task": "Fix RLS pentru join tables (shop_id denormalization)",
        "descriere_task": "Adaugă shop_id în join tables și activează RLS:\n\n```sql\n-- shopify_collection_products\nALTER TABLE shopify_collection_products ADD COLUMN IF NOT EXISTS shop_id UUID;\nUPDATE shopify_collection_products scp SET shop_id = sc.shop_id\nFROM shopify_collections sc WHERE scp.collection_id = sc.id AND scp.shop_id IS NULL;\nALTER TABLE shopify_collection_products ALTER COLUMN shop_id SET NOT NULL;\nALTER TABLE shopify_collection_products ENABLE ROW LEVEL SECURITY;\nALTER TABLE shopify_collection_products FORCE ROW LEVEL SECURITY;\nCREATE POLICY scp_tenant_isolation ON shopify_collection_products\n    USING (shop_id = current_setting('app.current_shop_id', true)::uuid);\n\n-- Repetă pentru shopify_product_media, shopify_variant_media\n```",
        "cale_implementare": "/Neanelu_Shopify/packages/database/drizzle/migrations/0016_fix_rls_join_tables.sql",
        "contextul_anterior": "F2.2.13 creează triggers. Join tables nu aveau shop_id - securitate RLS incompletă.",
        "validare_task": "Query fără context pe join tables returnează 0 rânduri (RLS activ).",
        "outcome_task": "Toate join tables au RLS complet cu shop_id denormalizat.",
        "restrictii_antihalucinatie": "NU omite FORCE RLS. Populează shop_id înainte de SET NOT NULL."
    },
    {
        "id_task": "F2.2.15",
        "denumire_task": "Creare indexuri lipsă pentru performanță",
        "descriere_task": "CREATE INDEX pentru toate indexurile identificate lipsă:\n\n```sql\nCREATE INDEX IF NOT EXISTS idx_ledger_shop_variant_date ON inventory_ledger(shop_id, variant_id, recorded_at DESC);\nCREATE INDEX IF NOT EXISTS idx_orders_processed ON shopify_orders(shop_id, processed_at DESC) WHERE processed_at IS NOT NULL;\nCREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_type, actor_id);\nCREATE INDEX IF NOT EXISTS idx_embeddings_product_current ON prod_embeddings(product_id) WHERE embedding_type = 'combined';\nCREATE INDEX IF NOT EXISTS idx_jobs_shop_created ON job_runs(shop_id, created_at DESC);\nCREATE INDEX IF NOT EXISTS idx_products_shop_updated ON shopify_products(shop_id, updated_at DESC);\nCREATE INDEX IF NOT EXISTS idx_jobs_group_status ON job_runs(group_id, status);\n```",
        "cale_implementare": "/Neanelu_Shopify/packages/database/drizzle/migrations/0017_add_missing_indexes.sql",
        "contextul_anterior": "F2.2.14 fixează RLS. Indexurile asigură performanță la scale.",
        "validare_task": "EXPLAIN ANALYZE pe query-uri relevante confirmă index scan (nu seq scan).",
        "outcome_task": "Toate indexurile critice pentru performanță sunt create.",
        "restrictii_antihalucinatie": "Folosește IF NOT EXISTS pentru idempotency. CONCURRENTLY pentru producție."
    },
    {
        "id_task": "F2.2.16",
        "denumire_task": "Adăugare CHECK constraints pentru data integrity",
        "descriere_task": "ADD CONSTRAINT CHECK pentru validare date:\n\n```sql\nALTER TABLE shopify_products ADD CONSTRAINT chk_status CHECK (status IN ('ACTIVE', 'DRAFT', 'ARCHIVED'));\nALTER TABLE bulk_runs ADD CONSTRAINT chk_operation_type CHECK (operation_type IN ('PRODUCTS_EXPORT', 'PRODUCTS_IMPORT', 'ORDERS_EXPORT', 'CUSTOMERS_EXPORT', 'INVENTORY_EXPORT', 'COLLECTIONS_EXPORT'));\nALTER TABLE inventory_ledger ADD CONSTRAINT chk_reason CHECK (reason IN ('SALE', 'RESTOCK', 'ADJUSTMENT', 'RETURN', 'SYNC', 'TRANSFER', 'DAMAGE', 'CORRECTION'));\nCREATE UNIQUE INDEX IF NOT EXISTS idx_shops_active_domain ON shops(shopify_domain) WHERE uninstalled_at IS NULL;\n```",
        "cale_implementare": "/Neanelu_Shopify/packages/database/drizzle/migrations/0018_add_constraints.sql",
        "contextul_anterior": "F2.2.15 creează indexuri. Constraints asigură data integrity.",
        "validare_task": "INSERT cu valoare invalidă pentru status/reason este respins cu constraint violation.",
        "outcome_task": "Data integrity asigurată prin CHECK constraints și UNIQUE partial indexes.",
        "restrictii_antihalucinatie": "NU folosi ENUM type - CHECK constraint e mai flexibil pentru ALTER."
    },
    {
        "id_task": "F2.2.17",
        "denumire_task": "Creare tabelă embedding_batches pentru OpenAI Batch Embeddings API (F6.1)",
        "descriere_task": "Migrație SQL pentru embedding_batches - tabelă specifică pentru OpenAI Batch API:\n\n```sql\nCREATE TABLE embedding_batches (\n    id UUID PRIMARY KEY DEFAULT uuidv7(),\n    shop_id UUID REFERENCES shops(id),\n    batch_type VARCHAR(30) NOT NULL CHECK (batch_type IN ('product_title', 'product_description', 'specs', 'combined', 'attribute')),\n    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'processing', 'completed', 'failed', 'cancelled')),\n    openai_batch_id VARCHAR(100),\n    input_file_id VARCHAR(100),\n    output_file_id VARCHAR(100),\n    error_file_id VARCHAR(100),\n    model VARCHAR(50) NOT NULL DEFAULT 'text-embedding-3-small',\n    dimensions INTEGER NOT NULL DEFAULT 1536,\n    total_items INTEGER NOT NULL DEFAULT 0,\n    completed_items INTEGER DEFAULT 0,\n    failed_items INTEGER DEFAULT 0,\n    tokens_used INTEGER DEFAULT 0,\n    estimated_cost DECIMAL(10,4),\n    submitted_at TIMESTAMPTZ,\n    completed_at TIMESTAMPTZ,\n    expires_at TIMESTAMPTZ,\n    error_message TEXT,\n    created_at TIMESTAMPTZ DEFAULT now(),\n    updated_at TIMESTAMPTZ DEFAULT now()\n);\n\nCREATE INDEX idx_embedding_batches_shop ON embedding_batches(shop_id);\nCREATE INDEX idx_embedding_batches_status ON embedding_batches(status);\n\nALTER TABLE embedding_batches ENABLE ROW LEVEL SECURITY;\nALTER TABLE embedding_batches FORCE ROW LEVEL SECURITY;\nCREATE POLICY embedding_batches_tenant_isolation ON embedding_batches\n    USING (shop_id IS NULL OR shop_id = current_setting('app.current_shop_id', true)::uuid);\n```",
        "cale_implementare": "/Neanelu_Shopify/packages/database/drizzle/migrations/0019_create_embedding_batches.sql",
        "contextul_anterior": "F2.2.16 adaugă constraints. Embedding_batches este PREREQUISITE pentru F6.1 AI embeddings.",
        "validare_task": "Migrația rulează. RLS filtrează corect. Check constraints respinge batch_type/status invalid.",
        "outcome_task": "Embedding batches table pregătită pentru OpenAI Batch Embeddings API în F6.",
        "restrictii_antihalucinatie": "NU confunda cu ai_batches - aceasta e specifică embeddings. DIMENSIUNI 1536 pentru text-embedding-3-small."
    }
    ]
    ```

### F2.3: Scripturi de seed (populare inițială a datelor pentru teste)

    ```JSON
    {
        "id_task": "F2.3.1",
        "denumire_task": "Seed script pentru date sintetice (10K produse, deterministic, dev+CI)",
        "descriere_task": "**CONFORM Docs (secțiunea 6.1):** Seed-ul trebuie să fie deterministic și suficient pentru validarea indexurilor.\n\n**Specificații seed:**\n- **Volum:** 10.000 produse (minim pentru validarea indexurilor JSONB + GIN)\n- **Distribuție:** 5 shops × 2.000 produse fiecare\n- **Determinism:** Seed faker cu valoare fixă (ex: `faker.seed(12345)`)\n- **Timp țintă:** < 30 secunde pe SSD local, < 60s în CI\n- **Scop:** DEV local + CI integration tests\n\n**Implementare:**\n```typescript\n// packages/database/src/seed.ts\nimport { faker } from '@faker-js/faker';\nfaker.seed(12345); // Deterministic!\n\nconst SHOPS_COUNT = 5;\nconst PRODUCTS_PER_SHOP = 2000;\n\n// Generare produse cu metafields JSONB realiste\nconst product = {\n  title: faker.commerce.productName(),\n  handle: faker.helpers.slugify(title),\n  metafields: {\n    description: faker.commerce.productDescription(),\n    tags: faker.helpers.arrayElements(['sale', 'new', 'featured'], 2),\n    custom: { weight: faker.number.float({ min: 0.1, max: 10 }) }\n  }\n};\n```\n\n**Scripts în root package.json:**\n- `db:seed` - populare dev\n- `db:seed:ci` - populare CI (poate fi mai mic, 1K produse)",
        "cale_implementare": "/Neanelu_Shopify/packages/database/src/seed.ts + scripts root",
        "precondition": "OBLIGATORIU: Rulează doar după succesul complet al F2.2.1-F2.2.3 (schema + RLS policies + test integrare). Verifică cu `pnpm run db:migrate:status`.",
        "contextul_anterior": "Schema este stabilă și migrațiile rulează. Tabelul products există cu toate coloanele + RLS activ.",
        "validare_task": "Rulează `pnpm run db:seed` și confirmă:\n1. 10.000 rânduri în products\n2. Timp < 30s\n3. Re-rularea generează ACELEAȘI date (determinism)\n4. Indexurile GIN funcționează: `EXPLAIN ANALYZE SELECT * FROM products WHERE metafields @> '{\"tags\": [\"sale\"]}'`",
        "outcome_task": "Dataset de 10K produse, deterministic, pentru validarea performanței și CI.",
        "restrictii_antihalucinatie": "NU folosi seed fără faker.seed() - datele vor fi diferite la fiecare rulare. NU genera < 10K produse - insuficient pentru validarea indexurilor. NU hardcoda secrete."
    }
    ```

## Faza F3: Core Backend & Shopify Auth (Săptămâna 3)

Durată: Săptămâna 3
Obiectiv: Server HTTP, OAuth offline complet, webhooks ingress cu enqueue minim, RLS enforcement, OTel early.

### F3.1: Configurare server Node.js (Fastify) și setări de bază

    ```JSON
    [
    {
        "id_task": "F3.1.1",
        "denumire_task": "Bootstrap server Fastify (apps/backend-worker)",
        "descriere_task": "Creează serverul HTTP în apps/backend-worker (Fastify), cu routing de bază și healthcheck.\n\nCerințe minime:\n- endpoint-uri canonice: /health/live (liveness) și /health/ready (readiness)\n- graceful shutdown (SIGTERM/SIGINT)\n- server ESM-only (type: module), Node.js v24\n- config/env validation (prin pachetul de config)\n- nu expune secrete în răspunsuri\n\nNOTĂ: Pentru PR-013, /health/ready.checks.shopify_api este strict \"config-valid\" (fără OAuth/token).",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/main.ts",
        "contextul_anterior": "F2 a stabilit data layer (PostgreSQL 18.1, Drizzle, RLS) și seed/testing.",
        "validare_task": "Pornește serverul local și verifică:\n1) GET /health/live returnează 200\n2) GET /health/ready returnează 200 doar dacă dependențele (DB/Redis + shopify_api=config-valid) sunt OK\n3) La SIGTERM serverul se închide fără request-uri tăiate (graceful)",
        "outcome_task": "Server HTTP rulează local, stabil și pregătit pentru integrare Shopify.",
        "restrictii_antihalucinatie": "Nu amesteca UI în backend-worker. Nu introduce framework alternativ (Express/Hono). Nu loga config cu secrete."
    },
    {
        "id_task": "F3.1.2",
        "denumire_task": "Config central + validare env (contract strict)",
        "descriere_task": "Definește schema variabilelor de mediu necesare pentru F3 și fail-fast la startup.\n\nVariabile obligatorii:\n- APP_HOST, SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SCOPES\n- DATABASE_URL, REDIS_URL\n- ENCRYPTION_KEY_*, ENCRYPTION_KEY_VERSION\n- OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_SERVICE_NAME\n\nInclude:\n- validare tipuri (string/URL/listă scopes)\n- suport dev/staging/prod\n- politică: .env.example doar placeholders, secrete numai prin env/secret manager",
        "cale_implementare": "/Neanelu_Shopify/packages/config/src/env.ts",
        "contextul_anterior": "F0/F1 definesc standardele de secrets management și .env.example.",
        "validare_task": "1) Pornește serverul fără o variabilă obligatorie și confirmă fail-fast cu mesaj clar\n2) Pornește serverul cu valori valide și confirmă boot OK",
        "outcome_task": "Config predictibil și safe-by-default pentru toate mediile.",
        "restrictii_antihalucinatie": "Nu citi secrete din fișiere versionate. Nu permite fallback-uri tăcute pentru chei critice."
    },
    {
        "id_task": "F3.1.3",
        "denumire_task": "HTTP hardening: request-id, timeouts, limits, trust proxy",
        "descriere_task": "Configurează comportamente standard de producție:\n- request id per cerere (x-request-id) și propagare în loguri\n- body size limits și timeouts rezonabile\n- trust proxy (necesar în spatele unui ingress/reverse proxy)\n- handler global de erori (mapare consistentă, fără stack trace în prod)",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/http/server.ts",
        "contextul_anterior": "Serverul Fastify există, dar fără politici de producție.",
        "validare_task": "1) Confirmă că fiecare răspuns are request id\n2) Confirmă că payload prea mare este respins\n3) Confirmă că erorile nu expun secrete/stack în prod mode",
        "outcome_task": "Server robust, predictibil și sigur conform practicilor DevOps.",
        "restrictii_antihalucinatie": "Nu implementa rate limiting global aici (acela este în F4.3). Nu expune stack trace în producție."
    },
    {
        "id_task": "F3.1.4",
        "denumire_task": "Logging structurat + redaction (PII/secrete)",
        "descriere_task": "Adaugă logging structurat pentru request lifecycle și evenimente de auth/webhooks.\n\nCerințe:\n- redactare automată pentru token-uri, Authorization, cookies, SHOPIFY headers sensibile\n- log level configurabil per mediu\n- corelare cu request id (și ulterior trace id din OTel)",
        "cale_implementare": "/Neanelu_Shopify/packages/logger/src/index.ts",
        "contextul_anterior": "F1 a definit standarde de calitate; F3 are nevoie de observabilitate minimă în loguri înainte de OTel complet.",
        "validare_task": "Trimite un request care include header Authorization și confirmă că nu apare în loguri. Confirmă că request id apare în fiecare log relevant.",
        "outcome_task": "Loguri utile pentru debugging fără scurgeri de secrete.",
        "restrictii_antihalucinatie": "Nu loga payload complet de webhook. Nu loga token-uri Shopify sau cookies de sesiune."
    }
    ]
    ```

    ```JSON
    {
        "id_task": "F3.1.4.1",
        "denumire_task": "Definire schema unificată de logging cu reguli de redaction PII",
        "descriere_task": "**CONFORM Problems & Fixes.md - Gap 2.1:** Definește schema obligatorie pentru toate logurile:\n\n**Schema JSON obligatorie:**\n```json\n{\n  \"timestamp\": \"ISO8601\",\n  \"level\": \"debug|info|warn|error|fatal\",\n  \"message\": \"Human-readable message\",\n  \"service\": \"backend-worker|web-admin|queue-manager\",\n  \"env\": \"dev|staging|prod\",\n  \"version\": \"semantic version\",\n  \"request_id\": \"UUID from X-Request-Id\",\n  \"trace_id\": \"OTel trace ID\",\n  \"span_id\": \"OTel span ID\",\n  \"shop_id\": \"UUID - RLS context\",\n  \"job_id\": \"BullMQ job ID (optional)\",\n  \"bulk_run_id\": \"UUID (optional)\",\n  \"user_id\": \"UUID (optional, redacted in logs)\",\n  \"error\": {\n    \"code\": \"ERROR_CODE\",\n    \"message\": \"redacted if contains PII\",\n    \"stack\": \"first 3 lines only in prod\"\n  },\n  \"context\": {}\n}\n```\n\n**Reguli de Redaction (packages/logger/src/redaction.ts):**\n- Token-uri: `[REDACTED_TOKEN]`\n- Email: `a***@***.com`\n- Phone: `+40***...XX`\n- API Keys: primele 4 + `***` + ultimele 4\n- Stack traces: truncate la 3 linii în prod\n- Câmpuri sensibile: `password`, `secret`, `token`, `authorization`\n\n**Implementare în @app/logger:**\n```typescript\nimport { pino } from 'pino';\nimport { trace } from '@opentelemetry/api';\n\nconst redactPatterns = [\n  'req.headers.authorization',\n  'req.headers.cookie',\n  '*.password',\n  '*.secret',\n  '*.token',\n  '*.access_token'\n];\n\nexport const logger = pino({\n  level: process.env.LOG_LEVEL || 'info',\n  redact: {\n    paths: redactPatterns,\n    censor: '[REDACTED]'\n  },\n  base: {\n    service: process.env.OTEL_SERVICE_NAME,\n    env: process.env.NODE_ENV,\n    version: process.env.npm_package_version\n  },\n  mixin: () => ({\n    trace_id: trace.getActiveSpan()?.spanContext().traceId,\n    span_id: trace.getActiveSpan()?.spanContext().spanId\n  })\n});\n```",
        "cale_implementare": "/Neanelu_Shopify/packages/logger/src/schema.ts + packages/logger/src/redaction.ts",
        "contextul_anterior": "F3.1.4 menționează logging + redaction dar fără schema concretă. Acest task definește contractul explicit.",
        "validare_task": "1. Logger-ul include toate câmpurile obligatorii\n2. Test: log cu token → [REDACTED] în output\n3. Test: log cu email → a***@***.com\n4. trace_id/span_id sunt populate când OTel e activ",
        "outcome_task": "Schema de logging unificată cross-service, cu redaction automată PII.",
        "restrictii_antihalucinatie": "NU loga niciodată token-uri în plaintext. Stack traces max 3 linii în prod. Redaction patterns sunt obligatorii."
    }
    ```

### F3.2: Implementare OAuth 2.0 (acces offline) cu Shopify și stocare token

    ```JSON
    [
    {
        "id_task": "F3.2.1",
        "denumire_task": "Implementare OAuth offline + storage token criptat (end-to-end)",
        "descriere_task": "Implementează fluxul OAuth pentru Shopify (offline access) end-to-end și persistă token-urile criptat în Postgres.\n\nInclude obligatoriu:\n- validarea parametrului shop (allowlist + format)\n- protecție CSRF (state) pentru callback\n- schimb code -> access token folosind Shopify SDK\n- stocare token criptat (AES-256-GCM) în Postgres (nu în memorie, nu doar în Redis)\n- upsert shop/tenant în tabelul shops și asocierea token-ului cu shop_id\n- comportament idempotent la reinstall",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/auth + packages/database/src",
        "contextul_anterior": "Serverul HTTP există. DB are tabele pentru shops/sessions/tokens și mecanisme de criptare definite în F2.",
        "validare_task": "Finalizează un install flow pe un dev store și confirmă:\n1) shop apare în DB\n2) token apare în DB criptat (nu plaintext)\n3) reinstall nu creează duplicate și nu sparge accesul",
        "outcome_task": "Aplicația poate autentifica magazine și păstra offline access în mod sigur.",
        "restrictii_antihalucinatie": "Nu stoca token-uri în Redis ca singură sursă de adevăr. Nu loga token-uri sau query string complet din callback."
    },
    {
        "id_task": "F3.2.2",
        "denumire_task": "Rute OAuth: /auth (start) cu validare shop + generare state",
        "descriere_task": "Implementează ruta de start pentru instalare:\n- citește shop din query\n- validează shop domain (fără wildcard, fără open redirect)\n- generează state/nonce și îl stochează în cookie\n- **IMPORTANT pt embedded apps:** Cookie trebuie să fie `SameSite=None; Secure` pentru a funcționa în iframe Shopify Admin\n- redirect către Shopify authorize URL cu scopes configurate",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/auth/routes/auth.start.ts",
        "contextul_anterior": "Config/env schema există (SHOPIFY_API_KEY/SCOPES/APP_HOST).",
        "validare_task": "1) shop invalid este respins\n2) shop valid produce redirect corect către Shopify\n3) state este setat și verificabil în callback",
        "outcome_task": "Pornirea OAuth este sigură și reproductibilă.",
        "restrictii_antihalucinatie": "Nu accepta shop arbitrar (evită SSRF/open redirect). Nu folosi cookies nesigure (secure=false) în medii non-local."
    },
    {
        "id_task": "F3.2.3",
        "denumire_task": "Rute OAuth: /auth/callback cu verificări complete și persistare",
        "descriere_task": "Implementează ruta de callback:\n- verifică state/CSRF\n- verifică semnătura/hmac conform Shopify (pentru query string)\n- face token exchange\n- persistă token offline criptat + metadate (scopes, shop_domain, issued_at)\n- asociază token-ul cu shop_id\n- setează sesiune minimală pentru admin UI (dacă e necesar)",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/auth/routes/auth.callback.ts",
        "contextul_anterior": "Ruta /auth există și generează state. DB crypto este disponibilă.",
        "validare_task": "1) callback cu state greșit este respins\n2) callback valid persistă token\n3) token este utilizabil pentru un request GraphQL simplu\n4) secrete nu apar în loguri",
        "outcome_task": "Callback corect, securizat, cu stocare durabilă.",
        "restrictii_antihalucinatie": "Nu accepta callback fără state. Nu procesa query parametrii fără verificare HMAC."
    },
    {
        "id_task": "F3.2.4",
        "denumire_task": "Contract multi-tenant: shop context și disciplină RLS pentru request-uri auth-bound",
        "descriere_task": "Leagă autentificarea de izolarea multi-tenant:\n- orice endpoint care lucrează cu date per shop rulează în tranzacție și setează `SET LOCAL app.current_shop_id = $shopId::uuid` înainte de query\n- definește helper withShopContext(shopId, fn)\n- evită leak de context la pool reutilizat",
        "cale_implementare": "/Neanelu_Shopify/packages/database/src/db.ts",
        "contextul_anterior": "RLS există în F2, dar trebuie impus în runtime în F3 pentru endpoint-urile reale.",
        "validare_task": "Rulează două request-uri consecutive pentru shop-uri diferite și confirmă că nu se vede cross-tenant data (integrare).",
        "outcome_task": "RLS este efectiv aplicat în runtime, nu doar în migrații.",
        "restrictii_antihalucinatie": "Nu executa query-uri multi-tenant fără SET LOCAL. Nu reutiliza conexiuni din pool fără resetare de context."
    },
    {
        "id_task": "F3.2.5",
        "denumire_task": "Token lifecycle: refresh/rotație pentru offline tokens (mecanism + fallback)",
        "descriere_task": "Implementează mecanismul de refresh/rotație pentru offline tokens și fallback operațional:\n- detectare token invalid/expirat la apel API\n- marcarea shop ca needing_reauth și declanșarea fluxului de reautorizare\n- job periodic care verifică starea token-urilor",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/auth/token-lifecycle.ts",
        "contextul_anterior": "OAuth offline funcționează, dar operațiile long-running cer reziliență la expirare/invalidare.",
        "validare_task": "Simulează token invalid (revocat) și confirmă:\n1) request-ul eșuează controlat\n2) shop este marcat needing_reauth\n3) nu intră în retry infinit",
        "outcome_task": "Auth rezilient pentru procese lungi și operații asincrone.",
        "restrictii_antihalucinatie": "Nu implementa retry infinit la token invalid. Nu bloca workerii cu reauth sincron."
    },
    {
        "id_task": "F3.2.6",
        "denumire_task": "Teste backend pentru OAuth (node:test) + mocking controlat",
        "descriere_task": "Adaugă teste unitare/integration pentru:\n- validare shop param\n- state/CSRF\n- token exchange (mock Shopify)\n- persistare criptată în DB\n\nRulează cu node:test; integrarea DB poate folosi Postgres ephemeral din CI.",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/auth/__tests__",
        "contextul_anterior": "F1.4 definește CI skeleton; F3 trebuie să livreze verificări automate pentru auth.",
        "validare_task": "Rulează testele local și în CI; confirmă că un bug introdus intenționat face testele să eșueze.",
        "outcome_task": "Auth acoperit de teste, reducând riscul de regresii.",
        "restrictii_antihalucinatie": "Nu folosi Jest. Nu introduce teste care depind de secrete reale Shopify."
    },
    {
        "id_task": "F3.2.7",
        "denumire_task": "Refactor Research OAuth to Production",
        "descriere_task": "**CONFORM Audit 2025-12-26:** Migrează codul research OAuth (`oauth-callback-server.ts` din root) în producție:\n\n**De la:** `/oauth-callback-server.ts` (script standalone research)\n**La:** `/apps/backend-worker/src/auth/` (integrat în aplicația principală)\n\n**Pași:**\n1. Extrage logica core (token exchange, criptare) în `packages/database/src/auth/`\n2. Integrează în rutele F3.2.2/F3.2.3 deja definite\n3. Șterge fișierul research sau marchează-l deprecated\n4. Actualizează .gitignore pentru artefacte research\n\n**Notă:** Codul research a validat flow-ul OAuth headless. Acum trebuie integrat în arhitectura monorepo.",
        "cale_implementare": "/oauth-callback-server.ts → /apps/backend-worker/src/auth/",
        "contextul_anterior": "F3.2.1-F3.2.6 definesc OAuth production dar codul research există izolat.",
        "validare_task": "1. oauth-callback-server.ts e șters sau marcat deprecated\n2. Flow-ul OAuth funcționează end-to-end în apps/backend-worker\n3. Nu există cod duplicat",
        "outcome_task": "Cod research migrat în producție, fără technical debt.",
        "restrictii_antihalucinatie": "NU păstra cod duplicat. NU hardcoda secrete în migrarea codului."
    }
    ]
    ```

### F3.3: Endpoint de Webhooks (validare HMAC și enqueuing evenimente)

    ```JSON
    [
    {
        "id_task": "F3.3.1",
        "denumire_task": "Webhook ingress: raw body + validare HMAC + răspuns rapid",
        "descriere_task": "Creează endpoint-ul /webhooks în apps/backend-worker:\n- citește raw body (obligatoriu pentru HMAC corect - Fastify addContentTypeParser)\n- validează X-Shopify-Hmac-Sha256 cu constant-time compare\n- validează topic + shop domain\n- răspunde 200 OK rapid după validare\n- nu face procesare grea în request",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/routes/webhooks.ts",
        "contextul_anterior": "Serverul HTTP există; Shopify auth există pentru a putea înregistra webhooks.",
        "validare_task": "1) webhook cu HMAC valid returnează 200 în timp scurt (<100ms)\n2) webhook cu HMAC invalid returnează 401/403\n3) payload mare peste limită este respins controlat",
        "outcome_task": "Ingress de webhooks sigur și performant.",
        "restrictii_antihalucinatie": "Nu accepta webhook fără validare HMAC. Nu procesa sincron (fără DB heavy, fără Shopify calls în request). Raw body e OBLIGATORIU pentru HMAC corect."
    },
    {
        "id_task": "F3.3.2",
        "denumire_task": "Contract de job pentru webhooks (schema payload + tipuri)",
        "descriere_task": "Definește structura payload-ului pus în coadă (minimal, fără payload complet):\n- shop_domain\n- topic\n- webhook_id (dacă există)\n- received_at\n- pointer către payload (opțional: stocare brută în DB/Redis cu TTL)\n\nDefinește și validarea runtime (schema) pentru a evita job-uri invalide.",
        "cale_implementare": "/Neanelu_Shopify/packages/types/src/webhooks.ts",
        "contextul_anterior": "Avem nevoie de un contract stabil între ingress și worker.",
        "validare_task": "Rulează validarea schema pentru payload valid și invalid; payload invalid trebuie respins înainte de enqueue.",
        "outcome_task": "Contract de job stabil și sigur pentru webhooks.",
        "restrictii_antihalucinatie": "Nu pune payload complet în job dacă poate conține date sensibile; preferă pointer/TTL storage."
    },
    {
        "id_task": "F3.3.3",
        "denumire_task": "Enqueue minim pentru webhooks (bootstrap înainte de F4 - REZOLVĂ DEPENDENȚA CIRCULARĂ)",
        "descriere_task": "**FIX CRONOLOGIE:** Pentru a elimina blocajul (F3.3 depindea de F4.1), implementează un mecanism MINIM de enqueue pentru webhook jobs direct în apps/backend-worker:\n\n- definește o coadă webhook-queue (BullMQ OSS) cu conexiune Redis\n- exportă un producer simplu enqueueWebhookJob(payload)\n- NU implementa fairness/groups/rate limiting aici\n\nÎn F4.1 vei REFACTORIZA acest cod în packages/queue-manager și vei activa BullMQ Pro Groups.",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/queue/webhook-queue.ts",
        "contextul_anterior": "Redis 8.4 rulează din F1.2; endpoint-ul de webhooks TREBUIE să poată enqueue din F3, nu abia în F4. **STRATEGIE INCREMENTALĂ INTENȚIONATĂ:** Această abordare este DELIBERATĂ - în săptămâna 3 creăm cod MINIM inline pentru a debloca funcționalitatea. În săptămâna 4 (F4.1.5) acest cod va fi REFACTORIZAT în packages/queue-manager. Aceasta NU este dependență circulară - este strategie de dezvoltare: 1) funcționalitate minimă (time-to-market), 2) refactorizare (calitate cod). Contractul API implicit: semnătura funcției `enqueueWebhookJob(payload)` definită aici devine contractul; F4.1.5 respectă aceeași semnătură.",
        "validare_task": "Trimite webhook de test și confirmă că job-ul apare în Redis (BullMQ) și că endpoint-ul răspunde rapid.",
        "outcome_task": "Webhooks pot fi enqueue corect încă din F3, fără dependență circulară cu F4.",
        "restrictii_antihalucinatie": "NU implementa fairness/rate limiting aici (sunt în F4). NU procesa job-ul în request. Acest cod TREBUIE refactorizat în F4.1."
    },
    {
        "id_task": "F3.3.4",
        "denumire_task": "Webhook registration lifecycle (după install + re-registrare controlată)",
        "descriere_task": "Adaugă task explicit pentru înregistrarea webhooks:\n- la finalul OAuth install, înregistrează topic-urile necesare (via Shopify API)\n- persistă webhook subscriptions în DB (id/topic)\n- definește o strategie de re-registrare (idempotent) la schimbări de versiune/config\n\nTopic-uri minime: app/uninstalled, products/create, products/update, products/delete, bulk_operations/finish",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/shopify/webhooks/register.ts",
        "contextul_anterior": "OAuth este funcțional; acum trebuie ca Shopify să trimită evenimente către aplicație.",
        "validare_task": "1) după install, confirmă în Shopify admin că webhooks sunt create\n2) reinstall nu dublează webhooks (idempotent)\n3) dacă lipsesc webhooks, job-ul de re-registrare le recreează",
        "outcome_task": "Webhooks sunt configurate corect și rămân sănătoase operațional.",
        "restrictii_antihalucinatie": "Nu înregistra webhooks înainte ca endpoint-ul să fie disponibil public (APP_HOST corect). Nu hardcoda topic-uri fără config central."
    },
    {
        "id_task": "F3.3.5",
        "denumire_task": "Handler obligatoriu: app/uninstalled (cleanup tokens + shop state)",
        "descriere_task": "Implementează procesarea corectă pentru uninstall:\n- la primirea webhook-ului app/uninstalled: marchează shop ca inactive\n- revocă/șterge token-urile din DB (sau le marchează revoked)\n- curăță job-uri pending pentru shop (unde e posibil)\n- log + metric pentru eveniment",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/webhooks/handlers/app-uninstalled.handler.ts",
        "contextul_anterior": "Ingress + enqueue există; trebuie să avem minimul de lifecycle management pentru securitate.",
        "validare_task": "Simulează app/uninstalled și confirmă:\n1) shop devine inactive în DB\n2) token nu mai e folosit de sistem\n3) nu apar retry-uri infinite",
        "outcome_task": "Sistem sigur: accesul este revocat la uninstall.",
        "restrictii_antihalucinatie": "Nu păstra token-uri active după uninstall. Nu încerca procesare sincronă în webhook request."
    },
    {
        "id_task": "F3.3.6",
        "denumire_task": "Idempotency / deduplicare webhooks (anti-retry storm)",
        "descriere_task": "Implementează deduplicare pentru webhooks (Shopify poate retrimite):\n- cheie de dedupe pe (shop, topic, webhook_id sau payload hash)\n- TTL rezonabil în Redis (ex: 5 minute)\n- dacă e duplicate: răspunde 200 dar nu enqueue din nou\n\n**Edge cases:**\n- **Retry tardiv (> 5 min):** Acceptat ca nou job (Shopify retry după network failure); riscul de procesare dublă e acceptabil vs. pierderea datelor\n- **Redis indisponibil:** Fallback: procesează oricum (duplicates rare < data loss); log WARN și alertă pentru Redis health\n- **Webhook malformat:** Reject cu 400 înainte de check dedupe",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/routes/webhooks.dedupe.ts",
        "contextul_anterior": "Webhook storms sunt un risc operațional; Docs recomandă abordări defensive.",
        "validare_task": "1) Trimite același webhook de 2 ori și confirmă că al doilea nu creează job nou\n2) Simulează Redis down și confirmă că webhook-ul trece (fallback)\n3) Trimite webhook la interval > 5 min și confirmă că e procesat ca nou",
        "outcome_task": "Sistem stabil la retry-uri și evenimente duplicate.",
        "restrictii_antihalucinatie": "Nu deduplica global între shop-uri. Nu folosi TTL prea mare fără motiv (risc de drop la evenimente legitime)."
    },
    {
        "id_task": "F3.3.7",
        "denumire_task": "Teste pentru webhooks: HMAC + enqueue + time budget",
        "descriere_task": "Adaugă teste cu node:test pentru:\n- validare HMAC corectă (raw body)\n- respingere HMAC invalid\n- confirmare că endpoint-ul nu face procesare grea (test de time budget / răspuns rapid <100ms)\n- confirmare enqueue apelat cu payload minimal",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/routes/__tests__/webhooks.test.ts",
        "contextul_anterior": "Webhook ingress este critic și trebuie protejat împotriva regresiilor.",
        "validare_task": "Rulează testele local și în CI; testele trebuie să pice dacă raw body nu e folosit sau dacă HMAC check e scos.",
        "outcome_task": "Webhook ingress acoperit de teste automatizate.",
        "restrictii_antihalucinatie": "Nu folosi Jest. Nu include payload-uri reale sensibile în fixture-uri."
    }
    ]
    ```

### F3.4: Observabilitate HTTP & Webhooks (OTel early)

    ```JSON
    [
    {
        "id_task": "F3.4.1",
        "denumire_task": "Instrumentare OpenTelemetry pentru HTTP + webhooks (boot-time)",
        "descriere_task": "Activează OpenTelemetry în backend-worker încă de la startup:\n- inițializează SDK înainte de a porni serverul\n- exporter OTLP către collector/Jaeger în dev\n- auto-instrumentations pentru http + pg + ioredis\n- sampling rezonabil (ex: 10% în prod, 100% în dev)",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/otel/index.ts",
        "contextul_anterior": "F1.2 include Jaeger în dev; F3 are nevoie de observabilitate timpurie pentru debugging.",
        "validare_task": "Verifică în Jaeger că apare un trace pentru un request la /healthz și pentru /webhooks.",
        "outcome_task": "Tracing funcțional în dev înainte de pipeline-ul bulk.",
        "restrictii_antihalucinatie": "Nu bloca runtime-ul dacă exporterul e indisponibil; fallback silențios. Nu activa sampling 100% în prod by default."
    },
    {
        "id_task": "F3.4.2",
        "denumire_task": "Corelare loguri cu trace/span + request id",
        "descriere_task": "Leagă logger-ul de contextul OTel:\n- include traceId/spanId în loguri când există\n- propagate request id în atribute OTel\n- loguri structurate pentru evenimente cheie (oauth success/fail, webhook accepted/rejected)",
        "cale_implementare": "/Neanelu_Shopify/packages/logger/src/otel-correlation.ts",
        "contextul_anterior": "F3.1.4 a introdus logging; acum îl corelăm cu tracing pentru debugging end-to-end.",
        "validare_task": "Creează un request /webhooks și confirmă că logul conține request id și (când tracing e activ) traceId/spanId.",
        "outcome_task": "Debugging rapid prin corelarea logs-traces.",
        "restrictii_antihalucinatie": "Nu introduce PII în atribute OTel. Nu loga payload complet."
    },
    {
        "id_task": "F3.4.3",
        "denumire_task": "Spans explicite pentru validare webhook + enqueue",
        "descriere_task": "Adaugă spans manuale (în plus față de auto-instrumentation) pentru:\n- verificare HMAC\n- dedupe decision\n- enqueue operation\n\nAtașează atribute: shop_domain, topic, outcome (accepted/rejected/duplicate).",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/routes/webhooks.ts",
        "contextul_anterior": "Auto-instrumentation nu acoperă toate punctele critice (HMAC, dedupe).",
        "validare_task": "În Jaeger, urmărește un trace care include explicit span-urile de HMAC și enqueue.",
        "outcome_task": "Vizibilitate exactă asupra celor mai riscante puncte din ingress.",
        "restrictii_antihalucinatie": "Nu atașa payload complet ca attribute. Nu adăuga cardinalitate mare (ex: product title) în tags."
    },
    {
        "id_task": "F3.4.4",
        "denumire_task": "Metrice minime pentru HTTP și webhooks",
        "descriere_task": "Expune metrice minime pentru:\n- request count/latency per route\n- webhooks accepted/rejected/duplicate\n- queue enqueue count\n\nPoate fi via OTel metrics cu exporter compatibil.",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/otel/metrics.ts",
        "contextul_anterior": "Trace-urile sunt utile, dar metricele sunt necesare pentru trenduri și alerting ulterior (F7).",
        "validare_task": "Confirmă că după trimiterea mai multor webhooks cresc contoarele corespunzătoare.",
        "outcome_task": "Bază pentru SLO/alerte din fazele ulterioare.",
        "restrictii_antihalucinatie": "Nu publica endpoint-uri de metrics public fără auth. Nu instrumenta excesiv (păstrează set minim)."
    }
    ]
    ```

    ```JSON
    {
        "id_task": "F3.4.5",
        "denumire_task": "Configurare OTel per environment (dev/staging/prod) cu variabile explicite",
        "descriere_task": "**CONFORM Problems & Fixes.md - Gap 2.7:** Documentează diferențele de configurare OTel per mediu:\n\n**Variabile în .env.example:**\n```bash\n# === Development ===\n# OTEL_SAMPLING_RATIO=1.0          # 100% traces\n# LOG_LEVEL=debug\n# OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317\n# OBS_DEBUG=1                       # verbose OTel diagnostics\n\n# === Staging ===\n# OTEL_SAMPLING_RATIO=0.5          # 50% traces\n# LOG_LEVEL=info\n\n# === Production ===\n# OTEL_SAMPLING_RATIO=0.1          # 10% traces\n# LOG_LEVEL=warn\n# OTEL_ERROR_SAMPLING=1.0          # 100% pentru erori\n```\n\n**Configurare dynamică în packages/config:**\n```typescript\nexport const otelConfig = {\n  samplingRatio: parseFloat(process.env.OTEL_SAMPLING_RATIO || '0.1'),\n  errorSamplingRatio: parseFloat(process.env.OTEL_ERROR_SAMPLING || '1.0'),\n  exporterEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '',\n  debug: process.env.OBS_DEBUG === '1',\n  serviceName: process.env.OTEL_SERVICE_NAME || 'neanelu-shopify'\n};\n```\n\n**CI Configuration (.github/workflows/ci.yml):**\n```yaml\nenv:\n  OTEL_SAMPLING_RATIO: \"1.0\"  # 100% în CI pentru debugging\n  LOG_LEVEL: debug\n  OTEL_EXPORTER_OTLP_ENDPOINT: \"\"  # disabled în CI (no collector)\n```",
        "cale_implementare": "/.env.example + /packages/config/src/otel.ts + .github/workflows/ci.yml",
        "contextul_anterior": "F3.4.1-4 configurează OTel dar fără diferențiere dev/staging/prod.",
        "validare_task": "1. În dev: sampling 100%, LOG_LEVEL=debug\n2. În prod: sampling 10%, LOG_LEVEL=warn\n3. CI: OTel dezactivat (endpoint gol)\n4. Erori: sampling 100% indiferent de mediu",
        "outcome_task": "Configurare OTel predictibilă și documentată per environment.",
        "restrictii_antihalucinatie": "NU activa sampling 100% în prod. NU bloca runtime dacă collector e indisponibil."
    }
    ```

### F3.5: Fundația Frontend (Vite 7.3, App Shell & Global UI)

    ```JSON
    [
    {
        "id_task": "F3.5.0.1",
        "denumire_task": "Design System Tokens în tailwind.config.ts",
        "descriere_task": "Definire design tokens: colors (primary, success, warning, error, muted), spacing scale (4/8/12/16/24/32/48/64px), typography scale (h1-h6, body, caption, mono), border-radius, shadows. Export ca CSS variables pentru refolosire în componente Polaris.",
        "cale_implementare": "/apps/web-admin/tailwind.config.ts, /apps/web-admin/app/globals.css",
        "contextul_anterior": "Workspace Vite/Tailwind v4 instalat.",
        "validare_task": "CSS variables exportate și folosite în cel puțin o componentă test.",
        "outcome_task": "Design system tokens centralizate și reutilizabile.",
        "restrictii_antihalucinatie": "NU defini culori hardcodate în componente. Toate valorile vin din tokens. P0 - BLOCKER."
    },
    {
        "id_task": "F3.5.1",
        "denumire_task": "Setup Workspace: Vite 7.3 & React Router v7",
        "descriere_task": "Inițializează proiectul `apps/web-admin`. Setup package.json cu `react`, `react-dom`, `@shopify/shopify-app-react-router`, `lucide-react`. Configurare `vite.config.ts` cu server proxy (/api -> backend) și Shopify HMR (plugin local dacă nu există pachet oficial). Configurare `tsconfig.json` cu path aliases (@/*).",
        "cale_implementare": "/apps/web-admin/vite.config.ts, /apps/web-admin/tsconfig.json",
        "contextul_anterior": "Start UI.",
        "validare_task": "Dev server rulează.",
        "outcome_task": "Mediu de lucru activ.",
        "restrictii_antihalucinatie": "Vite 7.3.0 este obligatoriu."
    },
    {
        "id_task": "F3.5.2",
        "denumire_task": "Instalare Polaris Web Components 2025-10 & Tailwind v4",
        "descriere_task": "Instalează Tailwind v4. Polaris Web Components 2025-10 se încarcă din CDN (nu există întotdeauna pachet npm public pentru componentele UI). Configurează componentele Polaris: `polaris-button`, `polaris-badge`, `polaris-card`, `polaris-text-field`, `polaris-select`, `polaris-data-table`, `polaris-progress-bar`, `polaris-modal`, `polaris-tabs`, `polaris-skeleton`, `polaris-tooltip`, `polaris-toast`.",
        "cale_implementare": "/apps/web-admin/components/polaris/*",
        "contextul_anterior": "Workspace gata.",
        "validare_task": "Folder components/polaris populat, componente Polaris importabile.",
        "outcome_task": "Component library Polaris complet.",
        "restrictii_antihalucinatie": "Folosește EXCLUSIV Polaris Web Components."
    },
    {
        "id_task": "F3.5.3",
        "denumire_task": "Implementare Global Elements (Toaster, Loader)",
        "descriere_task": "În `root.tsx`, adaugă `<Toaster />` (Sonner) și configurează AppProvider. Creează componenta `GlobalSpinner` folosind `Loader2` animate-spin. Implementează `ErrorBoundary` globală care afișează un `Alert` roșu în caz de crash React.",
        "cale_implementare": "/apps/web-admin/app/root.tsx",
        "contextul_anterior": "Componente gata.",
        "validare_task": "App-ul randează fără erori și afișează un toast de test la mount.",
        "outcome_task": "App Shell robust.",
        "restrictii_antihalucinatie": "Folosește Sonner, nu Toast primitiv."
    },
    {
        "id_task": "F3.5.4",
        "denumire_task": "Dashboard Home: Header & KPI Grid",
        "descriere_task": "Implementează `_index.tsx`. Header cu titlu 'Neanelu Monitor' și buton 'Refresh Data'. Grid 4x1 cu KPI Cards: Produse Totale (Icon Package), Cozi Active (Icon Cpu), Health (Icon Activity), Rate Erori (Icon Alert). Datele vor fi mockuite momentan.",
        "cale_implementare": "/apps/web-admin/app/routes/_index.tsx",
        "contextul_anterior": "Shell gata.",
        "validare_task": "Vizualizare Dashboard corectă.",
        "outcome_task": "Prima pagină UI.",
        "restrictii_antihalucinatie": "Folosește grid layout responsive."
    },
    {
        "id_task": "F3.5.5",
        "denumire_task": "Layout Shell (AppShell component)",
        "descriere_task": "Sidebar fix 280px cu navigation, Header cu shop selector + user menu, Main content area cu scroll. Mobile: hamburger menu. Responsive breakpoints: sm (640px), md (768px), lg (1024px), xl (1280px).",
        "cale_implementare": "/apps/web-admin/app/components/layout/app-shell.tsx",
        "contextul_anterior": "Design tokens definiți.",
        "validare_task": "Layout funcționează pe toate breakpoints, sidebar se ascunde pe mobile.",
        "outcome_task": "App shell responsive complet.",
        "restrictii_antihalucinatie": "Folosește CSS Grid/Flexbox, NU fixed positioning pentru layout principal."
    },
    {
        "id_task": "F3.5.6",
        "denumire_task": "Navigation System (NavLink, Breadcrumbs)",
        "descriere_task": "NavLink cu active state (background, border-left indicator), icons per route (folosește Lucide). Breadcrumbs component pentru navigare contextuală. useLocation() pentru highlighting. Integrare cu React Router v7.",
        "cale_implementare": "/apps/web-admin/app/components/layout/nav-link.tsx, /apps/web-admin/app/components/layout/breadcrumbs.tsx",
        "contextul_anterior": "AppShell există.",
        "validare_task": "Navigarea funcționează, active state vizibil, breadcrumbs se actualizează per route.",
        "outcome_task": "Sistem de navigare complet cu feedback vizual.",
        "restrictii_antihalucinatie": "NU folosesc window.location pentru navigare - doar React Router hooks."
    },
    {
        "id_task": "F3.5.7",
        "denumire_task": "Error Boundaries + Error Pages (404, 500, Offline)",
        "descriere_task": "React Router errorElement la nivel root și nested routes. Pagini dedicate: 404 (ilustrație, mesaj, link Home), 500 (retry button cu revalidare), Offline (detectare navigator.onLine cu event listeners).",
        "cale_implementare": "/apps/web-admin/app/components/errors/, /apps/web-admin/app/routes/",
        "contextul_anterior": "Navigare funcțională.",
        "validare_task": "Forțează erori și verifică afișarea paginilor corespunzătoare.",
        "outcome_task": "Error handling robust la nivel de aplicație.",
        "restrictii_antihalucinatie": "NU afișa stack traces în producție. Logging erori către backend/OTel."
    },
    {
        "id_task": "F3.5.7.1",
        "denumire_task": "API Error Handling Pattern (loaders/actions)",
        "descriere_task": "Definire pattern consistent pentru error handling în React Router v7 loaders și actions:\n\n**1. Loader Error Pattern:**\n- try/catch în loader\n- ApiError class cu status, message, retryable\n- throw new Response('Not Found', { status: 404 }) pentru 404\n- throw new Response('Internal Error', { status: 500 }) pentru erori neașteptate\n\n**2. Action Error Pattern (Form Mutations):**\n- return json({ errors: result.errors }, { status: 400 }) pentru validation errors\n- Preserve form state la eroare\n\n**3. Componente helper:**\n- ApiError class în /utils/api-error.ts\n- handleApiError() utility centralizat\n- useRouteError() + isRouteErrorResponse() pattern",
        "cale_implementare": "/apps/web-admin/app/utils/api-error.ts, /apps/web-admin/app/components/errors/error-list.tsx",
        "contextul_anterior": "F3.5.7 definește Error Boundaries pentru route errors. Acum extindem la API errors în loaders/actions.",
        "validare_task": "Simulează eroare API în loader -> afișează error page. Simulează validation error în action -> afișează inline errors fără pierdere form state.",
        "outcome_task": "Pattern consistent și reutilizabil pentru toate erorile API.",
        "restrictii_antihalucinatie": "NU folosesc try/catch în componente React pentru fetch - DOAR în loaders/actions. Erorile neașteptate TREBUIE să ajungă la error boundary."
    },
    {
        "id_task": "F3.5.7.2",
        "denumire_task": "Form Validation Error Display Components",
        "descriere_task": "Implementare componente pentru afișarea erorilor de validare în formulare:\n\n**1. FieldError component:**\n- Props: name, errors (Record<string, string[]>)\n- Afișează prima eroare pentru câmpul respectiv\n- role='alert' pentru a11y\n\n**2. FormErrorSummary:**\n- Polaris Banner status='critical'\n- Listează toate erorile din formular\n- Afișat deasupra formularului\n\n**3. Integrare cu useActionData + useFetcher:**\n- Preserve form state la eroare (nu reset)\n- Focus pe primul câmp cu eroare (a11y)\n- aria-describedby link între input și error message\n\n**4. Zod integration:**\n- Folosește Zod pentru validare (consistent cu backend)\n- z.object().safeParse() în action",
        "cale_implementare": "/apps/web-admin/app/components/forms/field-error.tsx, form-error-summary.tsx",
        "contextul_anterior": "F3.5.7.1 definește pattern pentru returnarea erorilor din actions.",
        "validare_task": "Submit formular cu date invalide -> erori afișate inline, focus pe primul câmp invalid, form state preserved.",
        "outcome_task": "UX consistent pentru validation errors în toate formularele.",
        "restrictii_antihalucinatie": "NU folosesc state local pentru erori - erorile VIN din actionData. Zod pentru validation (consistent cu backend)."
    },
    {
        "id_task": "F3.5.7.3",
        "denumire_task": "Graceful Degradation Strategy (Component-level fallbacks)",
        "descriere_task": "Implementare strategie de degradare grațioasă pentru componente non-critice:\n\n**1. SafeComponent wrapper (react-error-boundary):**\n- Fallback UI pentru componente izolate\n- onError callback pentru logging la OTel\n- Reset error state button\n\n**2. ComponentErrorFallback UI:**\n- Card cu mesaj 'Această secțiune nu a putut fi încărcată'\n- Buton 'Reîncearcă' care face reset error boundary\n- NU afișează stack trace în producție\n\n**3. Aplicare pe secțiuni izolate:**\n- Charts/grafice (pot eșua fără a bloca pagina)\n- Widget-uri third-party\n- Secțiuni opționale din dashboard\n\n**4. Document componente critice vs graceful:**\n- Critice: Navigation, Forms, Auth -> eroare = pagină completă\n- Graceful: Charts, Metrics, Activity Feed -> eroare = fallback inline",
        "cale_implementare": "/apps/web-admin/app/components/errors/safe-component.tsx, component-error-fallback.tsx",
        "contextul_anterior": "F3.5.7 și F3.5.7.1-2 acoperă route-level și form errors. Acum adăugăm component-level isolation.",
        "validare_task": "Forțează crash într-un chart -> doar chart-ul afișează fallback, restul paginii funcționează.",
        "outcome_task": "Reziliență la nivel de componentă, experiență utilizator neîntreruptă.",
        "restrictii_antihalucinatie": "NU aplicați SafeComponent pe TOTUL - doar pe secțiuni izolate. Erorile critice TREBUIE să ajungă la route error boundary."
    },
    {
        "id_task": "F3.5.8",
        "denumire_task": "Setup Vitest + Testing Library pentru component testing",
        "descriere_task": "Configurare vitest.config.ts cu jsdom environment. Instalare @testing-library/react, @testing-library/user-event. Setup file cu custom render (providers wrapper pentru Context/Router). Minim 1 test per component Polaris wrapped.",
        "cale_implementare": "/apps/web-admin/vitest.config.ts, /apps/web-admin/src/__tests__/",
        "contextul_anterior": "Componente UI există.",
        "validare_task": "pnpm -w run test:frontend trece fără erori.",
        "outcome_task": "Infrastructură de testing pregătită.",
        "restrictii_antihalucinatie": "NU folosim Jest în frontend - doar Vitest. Tests se rulează în CI."
    },
    {
        "id_task": "F3.5.9",
        "denumire_task": "TypeScript types shared (@app/types package)",
        "descriere_task": "Creare packages/types cu: API response types (PaginatedResponse, ErrorResponse), Job/Queue types, Product/Variant types, User/Shop types. Export din package, import în frontend și backend.",
        "cale_implementare": "/Neanelu_Shopify/packages/types/src/",
        "contextul_anterior": "Monorepo configurat cu pnpm workspaces.",
        "validare_task": "Import din @app/types funcționează în ambele apps (backend + frontend).",
        "outcome_task": "Single source of truth pentru tipuri partajate.",
        "restrictii_antihalucinatie": "NU duplica tipuri între apps. Toate tipurile comune merg în @app/types."
    },
    {
        "id_task": "F3.5.10",
        "denumire_task": "API Client setup (fetch wrapper, interceptors, error handling)",
        "descriere_task": "Wrapper peste fetch cu: base URL config din env, auth header injection (Shopify session token), response type parsing, error normalization. Hook useApiClient() pentru React cu loading/error states.",
        "cale_implementare": "/apps/web-admin/app/lib/api-client.ts, /apps/web-admin/app/hooks/use-api.ts",
        "contextul_anterior": "@app/types definite.",
        "validare_task": "Request către /api/health funcționează cu auth header.",
        "outcome_task": "Comunicare frontend-backend standardizată.",
        "restrictii_antihalucinatie": "NU face fetch direct în componente - folosește hooks/loaders."
    },
    {
        "id_task": "F3.5.11",
        "denumire_task": "Loading/Error/Empty State components (pattern library)",
        "descriere_task": "Componente reutilizabile: <LoadingState /> (skeleton sau spinner), <ErrorState message retryFn />, <EmptyState icon title description action />. Folosite consistent în toate paginile.",
        "cale_implementare": "/apps/web-admin/app/components/patterns/",
        "contextul_anterior": "Componente UI primitive există.",
        "validare_task": "Fiecare pagină folosește aceste componente pentru cele 3 stări.",
        "outcome_task": "Pattern library pentru stări de încărcare.",
        "restrictii_antihalucinatie": "NU implementa loading/error inline în fiecare pagină - refolosește componente."
    },
    {
        "id_task": "F3.5.12",
        "denumire_task": "Form patterns (validation, error display, submission states)",
        "descriere_task": "Integrare react-hook-form + zod pentru validare. FormField component cu label, input, error message. Submit button states: idle, loading (spinner), success (checkmark), error (retry).",
        "cale_implementare": "/apps/web-admin/app/components/forms/",
        "contextul_anterior": "Pattern components există.",
        "validare_task": "Form de test funcționează cu validare client-side și server-side.",
        "outcome_task": "Form handling standardizat în aplicație.",
        "restrictii_antihalucinatie": "NU validez doar pe client - schema zod partajată cu backend."
    },
    {
        "id_task": "F3.5.13",
        "denumire_task": "Component Specification Documentation",
        "descriere_task": "Creare și menținere document Docs/Frontend_Component_Specs.md cu specificații complete:\n\n**Per componentă:**\n- Props table (Prop, Type, Required, Default, Description)\n- States (default, hover, focus, loading, error, disabled)\n- Usage example cu cod TSX\n- Accessibility notes (ARIA, keyboard nav)\n\n**Componente documentate:**\n1. Layout: AppShell, NavLink, Breadcrumbs, PageHeader\n2. Forms: FieldError, FormErrorSummary\n3. Errors: SafeComponent, ErrorBoundary\n4. Domain: JobsTable, MetricCard, LogConsole, ProductCard\n5. Hooks: useJobPolling, useRecentSearches\n\n**Format:** Markdown cu tabele, code blocks, changelog.",
        "cale_implementare": "Docs/Frontend_Component_Specs.md",
        "contextul_anterior": "Componentele sunt definite în task-uri dar lipsesc specificații props/states uniformizate.",
        "validare_task": "Documentul există, conține >15 componente cu props table, cel puțin 5 usage examples, toate hooks documentate.",
        "outcome_task": "Catalog complet de componente cu API reference pentru dezvoltatori.",
        "restrictii_antihalucinatie": "NU inventați componente care nu sunt în Plan. Documentați doar ce e definit în task-urile F3-F7."
    }
    ]
    ```

### F3.6: Dashboard Extins (Analytics & Quick Actions)

    ```JSON
    [
    {
        "id_task": "F3.6.1",
        "denumire_task": "Dashboard: Grafic Timeline Activitate (ultimele 7 zile)",
        "descriere_task": "Line chart cu Recharts arătând jobs procesate per zi. Hover tooltip cu breakdown per tip job (sync, webhook, bulk, ai-batch). Agregare date din queue-manager + Redis metrics.",
        "cale_implementare": "/apps/web-admin/app/routes/dashboard/components/ActivityTimeline.tsx",
        "contextul_anterior": "Dashboard de bază există din F3.5.4. BullMQ cozi definite în F4.1.",
        "validare_task": "Chart-ul afișează date reale din ultimele 7 zile. Tooltip arată breakdown corect.",
        "outcome_task": "Vizualizare activitate sistem cu trend zilnic.",
        "restrictii_antihalucinatie": "NU implementa polling agresiv - max 1 request/minut. Folosește date din cache Redis.",
        "prioritate": "P2"
    },
    {
        "id_task": "F3.6.2",
        "denumire_task": "Dashboard: Quick Actions Panel",
        "descriere_task": "Butoane rapide: Start Sync (trigger manual sync job), Clear Cache (invalidează Redis cache patterns), View Logs (link către observability), Check Health (endpoint health check cu feedback visual). Confirmări modale unde e necesar (Clear Cache).",
        "cale_implementare": "/apps/web-admin/app/routes/dashboard/components/QuickActionsPanel.tsx",
        "contextul_anterior": "Dashboard layout există. Backend endpoints pentru sync/health există din F3.",
        "validare_task": "Fiecare acțiune funcționează și afișează feedback (success/error toast). Clear Cache cere confirmare.",
        "outcome_task": "Acces rapid la acțiuni comune fără navigare.",
        "restrictii_antihalucinatie": "NU permite Clear Cache fără confirmare. Rate limit pe Start Sync (max 1/oră).",
        "prioritate": "P3"
    },
    {
        "id_task": "F3.6.3",
        "denumire_task": "Dashboard: System Alerts Banner",
        "descriere_task": "Banner persistent în dashboard când există probleme: Redis down, API slow (latency > 2s), Jobs backlog (> 1000 pending). Dismiss per sesiune (sessionStorage). Culori diferite per severitate (warning/critical).",
        "cale_implementare": "/apps/web-admin/app/routes/dashboard/components/SystemAlertsBanner.tsx",
        "contextul_anterior": "Health check endpoint există din F3.1. Observabilitate OTel din F3.4.",
        "validare_task": "Banner apare când simulezi Redis down. Dismiss persistă în sesiune. Se reafișează la refresh dacă problema persistă.",
        "outcome_task": "Alertare proactivă pentru administratori.",
        "restrictii_antihalucinatie": "NU bloca UI-ul cu alerts. Max 3 alerte vizibile simultan. Polling health max 1/30s.",
        "prioritate": "P2"
    }
    ]
    ```

### F3.7: Shopify Integration UI (Embedded App Foundation)

    ```JSON
    [
    {
        "id_task": "F3.7.1",
        "denumire_task": "Shopify App Bridge Integration",
        "descriere_task": "Setup @shopify/app-bridge-react. Provider în root.tsx. Title bar sync cu React Router. Redirect modal handling. Session token authentication.",
        "cale_implementare": "/apps/web-admin/app/root.tsx + /apps/web-admin/app/shopify/",
        "contextul_anterior": "OAuth backend gata din F3.2. Frontend layout din F3.5.",
        "validare_task": "App se încarcă corect în iframe Shopify Admin. Titlul din Title Bar se sincronizează cu ruta curentă.",
        "outcome_task": "Aplicația embedded funcționează nativ în Shopify Admin.",
        "restrictii_antihalucinatie": "NU folosiți App Bridge vechi (deprecated). Versiunea trebuie să fie compatibilă cu 2025-10 API.",
        "prioritate": "P0 - BLOCKER (embedded app)"
    },
    {
        "id_task": "F3.7.2",
        "denumire_task": "Shop Selector / Multi-shop support UI",
        "descriere_task": "Dacă userul are acces la multiple shops: dropdown în header pentru switch. Persist selection în session. Reload data on switch.",
        "cale_implementare": "/apps/web-admin/app/components/layout/ShopSelector.tsx",
        "contextul_anterior": "App Bridge gata (F3.7.1). Session management din F3.2.",
        "validare_task": "Dropdown afișează shops disponibile. Switch re-încarcă dashboard cu date din shop-ul selectat.",
        "outcome_task": "Suport multi-shop pentru agențiile care administrează multiple magazine.",
        "restrictii_antihalucinatie": "NU stocați shop ID în localStorage (security). Folosiți session server-side.",
        "prioritate": "P2"
    },
    {
        "id_task": "F3.7.3",
        "denumire_task": "Session Token Refresh UI (auto + manual)",
        "descriere_task": "Detectare când session token expiră. Toast warning înainte de expirare. Auto-refresh în background. Fallback: modal 'Session expired, click to refresh'.",
        "cale_implementare": "/apps/web-admin/app/hooks/useSessionToken.ts + /apps/web-admin/app/components/SessionExpiredModal.tsx",
        "contextul_anterior": "App Bridge provider gata (F3.7.1).",
        "validare_task": "Warning toast apare cu 5 minute înainte de expirare. Modal apare dacă auto-refresh eșuează.",
        "outcome_task": "UX fluid fără întreruperi de sesiune.",
        "restrictii_antihalucinatie": "NU reîncărcați toată pagina la refresh. Folosiți App Bridge getSessionToken().",
        "prioritate": "P1"
    },
    {
        "id_task": "F3.7.4",
        "denumire_task": "OAuth Callback Handling (frontend side)",
        "descriere_task": "Pagină /auth/callback care procesează OAuth response. Loading state, error handling, redirect to dashboard on success.",
        "cale_implementare": "/apps/web-admin/app/routes/auth.callback.tsx",
        "contextul_anterior": "OAuth backend gata din F3.2. App Bridge din F3.7.1.",
        "validare_task": "Callback procesează corect success/error. Redirect la dashboard după autentificare.",
        "outcome_task": "Flow OAuth complet pe partea de frontend.",
        "restrictii_antihalucinatie": "NU salvați tokens în frontend. Tokens rămân server-side.",
        "prioritate": "P1"
    },
    {
        "id_task": "F3.7.5",
        "denumire_task": "Shopify Admin Redirect Link (open product in Shopify)",
        "descriere_task": "Button/link pe product cards care deschide produsul în Shopify Admin. Folosește App Bridge pentru navigare în context.",
        "cale_implementare": "/apps/web-admin/app/components/domain/ShopifyAdminLink.tsx",
        "contextul_anterior": "App Bridge gata (F3.7.1). Product cards există în UI.",
        "validare_task": "Click deschide produsul în Shopify Admin fără a părăsi iframe-ul.",
        "outcome_task": "Navigare fluidă între aplicație și Shopify Admin.",
        "restrictii_antihalucinatie": "Folosiți App Bridge Redirect, nu window.open.",
        "prioritate": "P3"
    }
    ]
    ```

### F3.8: Data Fetching Patterns (Arhitectură Frontend)

    ```JSON
    [
    {
        "id_task": "F3.8.1",
        "denumire_task": "React Router Loaders setup (server state)",
        "descriere_task": "Definire pattern pentru loader functions în React Router v7. Type-safe cu LoaderFunctionArgs. Error handling standardizat. useLoaderData() usage patterns.",
        "cale_implementare": "/apps/web-admin/app/routes/*.tsx + /apps/web-admin/app/utils/loaders.ts",
        "contextul_anterior": "Arhitectura RR7 din F3.5 definește routing. Loaders sunt mecanismul primar pentru data fetching.",
        "validare_task": "Cel puțin o rută folosește loader + useLoaderData. Errors sunt caught și afișate.",
        "outcome_task": "Pattern consistent pentru server state în toată aplicația.",
        "restrictii_antihalucinatie": "NU folosiți fetch direct în componente - loaders sunt single source of truth.",
        "prioritate": "P1"
    },
    {
        "id_task": "F3.8.2",
        "denumire_task": "React Router Actions setup (mutations)",
        "descriere_task": "Pattern pentru action functions. Form handling cu <Form>. Optimistic UI updates. useActionData() + useFetcher() patterns.",
        "cale_implementare": "/apps/web-admin/app/routes/*.tsx + /apps/web-admin/app/utils/actions.ts",
        "contextul_anterior": "Loaders gata (F3.8.1). Actions sunt complementul pentru mutations.",
        "validare_task": "Form submission folosește <Form> + action. Feedback vizual pe submit.",
        "outcome_task": "Mutations consistent handled prin RR7 actions.",
        "restrictii_antihalucinatie": "NU folosiți fetch direct pentru POST/PUT - actions sunt preferați.",
        "prioritate": "P1"
    },
    {
        "id_task": "F3.8.3",
        "denumire_task": "TanStack Query integration (sau decizie de a NU folosi)",
        "descriere_task": "ADR: folosim TanStack Query pentru polling/real-time SAU doar loaders? Dacă DA: setup QueryClient, devtools, default options (staleTime, cacheTime). Dacă NU: documentează de ce RR7 loaders sunt suficiente.",
        "cale_implementare": "/apps/web-admin/app/root.tsx (QueryProvider) + /apps/web-admin/app/lib/query-client.ts + ADR doc",
        "contextul_anterior": "Loaders și Actions gata (F3.8.1-2). Decizie arhitecturală necesară pentru polling.",
        "validare_task": "ADR documentat cu pro/contra. Dacă TanStack: devtools vizibile în development.",
        "outcome_task": "Decizie clară și documentată pentru data fetching strategy.",
        "restrictii_antihalucinatie": "NU adăugați TanStack Query fără justificare - loaders pot fi suficiente.",
        "prioritate": "P1 - DECIZIE ARHITECTURALĂ"
    },
    {
        "id_task": "F3.8.4",
        "denumire_task": "Polling pattern pentru long-running operations",
        "descriere_task": "Hook usePolling(interval, condition). Folosit pentru: job status, ingestion progress, bulk op status. Auto-stop când completed. Integrat cu TanStack Query sau custom implementation.",
        "cale_implementare": "/apps/web-admin/app/hooks/use-polling.ts",
        "contextul_anterior": "Decizie TanStack (F3.8.3). Jobs și ingestion au status async.",
        "validare_task": "Job status se actualizează la interval. Polling oprește automat când job completed.",
        "outcome_task": "Pattern reutilizabil pentru toate operațiile long-running.",
        "restrictii_antihalucinatie": "NU faceți polling infinit - condiție de stop obligatorie. Cleanup pe unmount.",
        "prioritate": "P1"
    },
    {
        "id_task": "F3.8.5",
        "denumire_task": "Optimistic Updates pattern",
        "descriere_task": "Pattern pentru update UI înainte de server response. Rollback on error. Folosit pentru: retry job, delete job, toggle settings. Integrat cu useFetcher() sau TanStack.",
        "cale_implementare": "/apps/web-admin/app/hooks/use-optimistic.ts + exemple în componente",
        "contextul_anterior": "Actions gata (F3.8.2). UX premium necesită feedback instant.",
        "validare_task": "Click pe 'Retry' → UI se actualizează imediat. Error → rollback vizibil.",
        "outcome_task": "UX fluid pentru acțiuni frecvente.",
        "restrictii_antihalucinatie": "OBLIGATORIU rollback logic. NU ascundeți erori sub optimistic update.",
        "prioritate": "P2"
    },
    {
        "id_task": "F3.8.6",
        "denumire_task": "Cache Invalidation strategy",
        "descriere_task": "Când invalidăm cache-ul? După mutations, după WebSocket events, manual refresh. Document strategy per resource type. Implementare cu revalidate (RR7) sau queryClient.invalidate (TanStack).",
        "cale_implementare": "/apps/web-admin/app/lib/cache-strategy.ts + documentație",
        "contextul_anterior": "Loaders, actions, polling gata. Cache strategy unifică comportamentul.",
        "validare_task": "După mutation → lista se actualizează fără page refresh. Documentație existentă.",
        "outcome_task": "Cache predictibil și consistent.",
        "restrictii_antihalucinatie": "NU invalidați totul la fiecare mutation - targeted invalidation.",
        "prioritate": "P2"
    }
    ]
    ```

### F3.9: Core UI Components Avansate (Audit Frontend - Săptămâna 3-4)

> **Origine:** Audit Frontend 2025-12-26 - Componente lipsă identificate în `FRONTEND_AUDIT_COMPLET_2025-12-26.md`
> **Dependențe:** F3.5 (Foundation), F3.8 (Data Fetching Patterns)

    ```JSON
    [
    {
        "id_task": "F3.9.1",
        "denumire_task": "VirtualizedList Component",
        "descriere_task": "Implementare VirtualizedList cu @tanstack/react-virtual pentru liste 10k+ itemi. Props: items, renderItem, estimateSize, overscan, loadMore, isLoading. Features: virtualizare eficientă, infinite scroll, keyboard navigation.",
        "cale_implementare": "/apps/web-admin/app/components/ui/VirtualizedList.tsx",
        "contextul_anterior": "F3.5.2 are polaris-data-table dar nu virtualizare pentru liste mari.",
        "validare_task": "Lista cu 10000 itemi se renderează instant, scroll smooth 60fps.",
        "outcome_task": "Componenta reutilizabilă pentru orice listă mare.",
        "restrictii_antihalucinatie": "NU re-implementați virtualizare - folosiți @tanstack/react-virtual.",
        "prioritate": "P1"
    },
    {
        "id_task": "F3.9.2",
        "denumire_task": "JsonViewer Component",
        "descriere_task": "Implementare JsonViewer cu syntax highlighting și expand/collapse. Props: data, collapsed, theme, copyable, maxHeight. Features: nested objects, copy to clipboard, search within JSON.",
        "cale_implementare": "/apps/web-admin/app/components/ui/JsonViewer.tsx",
        "contextul_anterior": "LogConsole din F3.5 afișează text plain, nu JSON structurat.",
        "validare_task": "JSON de 100 nivele se afișează corect, expand/collapse funcțional.",
        "outcome_task": "Vizualizare JSON enterprise-grade pentru debugging.",
        "restrictii_antihalucinatie": "Folosiți react-json-view-lite, NU implementați parser custom.",
        "prioritate": "P1"
    },
    {
        "id_task": "F3.9.3",
        "denumire_task": "Timeline Component",
        "descriere_task": "Timeline verticală pentru activity logs. Props: events, orientation, loading, loadMore. Features: grupare per zi, relative timestamps, expandable details, infinite scroll.",
        "cale_implementare": "/apps/web-admin/app/components/ui/Timeline.tsx",
        "contextul_anterior": "F3.6.1 ActivityTimeline menționat dar nespecificat.",
        "validare_task": "Timeline cu 100+ events grupate per zi, expand funcțional.",
        "outcome_task": "Componenta refolosibilă pentru activity logs.",
        "restrictii_antihalucinatie": "Folosiți date-fns pentru grouping.",
        "prioritate": "P2"
    },
    {
        "id_task": "F3.9.4",
        "denumire_task": "TreeView Component",
        "descriere_task": "TreeView pentru structuri ierarhice. Props: data, selected, expanded, onSelect, onExpand, multiSelect, draggable. Features: expand/collapse, multi-select, drag & drop, lazy loading.",
        "cale_implementare": "/apps/web-admin/app/components/ui/TreeView.tsx",
        "contextul_anterior": "Taxonomy în PIM necesită tree navigation (F8.2.1).",
        "validare_task": "TreeView cu 500 nodes, expand/collapse smooth, drag works.",
        "outcome_task": "Componenta pentru structuri arborescente.",
        "restrictii_antihalucinatie": "Folosiți @dnd-kit/core pentru drag-drop.",
        "prioritate": "P2"
    },
    {
        "id_task": "F3.9.5",
        "denumire_task": "Charts Library - Recharts Integration",
        "descriere_task": "Setup recharts: theme integration cu design tokens, ChartContainer wrapper, ChartTooltip/Legend/Grid styled. Base exports pentru toate chart types.",
        "cale_implementare": "/apps/web-admin/app/components/charts/index.ts",
        "contextul_anterior": "Auditul identifică charts ca lipsă completă.",
        "validare_task": "ChartContainer responsive, theme colors aplicate.",
        "outcome_task": "Foundation pentru chart components.",
        "restrictii_antihalucinatie": "Folosiți recharts, NU Chart.js.",
        "prioritate": "P1"
    },
    {
        "id_task": "F3.9.6",
        "denumire_task": "LineChart Component",
        "descriere_task": "LineChart pe recharts. Props: data, lines, xAxisKey, height, showGrid, showTooltip, showLegend. Variants: simple, multi-line, area fill.",
        "cale_implementare": "/apps/web-admin/app/components/charts/LineChart.tsx",
        "contextul_anterior": "F3.9.5 chart foundation.",
        "validare_task": "LineChart cu 3 linii, 100 puncte, tooltip funcțional.",
        "outcome_task": "Chart pentru trends.",
        "prioritate": "P1"
    },
    {
        "id_task": "F3.9.7",
        "denumire_task": "BarChart Component",
        "descriere_task": "BarChart pe recharts. Props: data, bars, layout, stacked, showValues. Variants: simple, grouped, stacked, horizontal.",
        "cale_implementare": "/apps/web-admin/app/components/charts/BarChart.tsx",
        "contextul_anterior": "F3.9.5 chart foundation.",
        "validare_task": "BarChart stacked cu 5 categorii, legend funcțional.",
        "outcome_task": "Chart pentru comparisons.",
        "prioritate": "P1"
    },
    {
        "id_task": "F3.9.8",
        "denumire_task": "PieChart și DonutChart",
        "descriere_task": "Pie/Donut charts pe recharts. Props: data, showLabels, showLegend. DonutChart: innerRadius, centerLabel. Features: hover highlight, click handler.",
        "cale_implementare": "/apps/web-admin/app/components/charts/PieChart.tsx, DonutChart.tsx",
        "contextul_anterior": "F3.9.5 chart foundation.",
        "validare_task": "DonutChart cu 8 segmente, center label, hover works.",
        "outcome_task": "Charts pentru distributions.",
        "prioritate": "P2"
    },
    {
        "id_task": "F3.9.9",
        "denumire_task": "Sparkline Component",
        "descriere_task": "Sparkline minimalist. Props: data, width, height, color, showChange, trend. Features: inline cu text, no axes, trend indicator.",
        "cale_implementare": "/apps/web-admin/app/components/charts/Sparkline.tsx",
        "contextul_anterior": "MetricCard din F3.5 are loc pentru sparkline.",
        "validare_task": "Sparkline 50px width inline, smooth rendering.",
        "outcome_task": "Micro-chart pentru inline trends.",
        "prioritate": "P2"
    },
    {
        "id_task": "F3.9.10",
        "denumire_task": "GaugeChart Component",
        "descriere_task": "GaugeChart pentru metrics. Props: value, min, max, thresholds, size, showValue. Features: semi-circle, color zones, animated needle.",
        "cale_implementare": "/apps/web-admin/app/components/charts/GaugeChart.tsx",
        "contextul_anterior": "F7.7.1 HealthDashboard necesită gauges.",
        "validare_task": "GaugeChart cu 3 thresholds, animated needle.",
        "outcome_task": "Visual indicator pentru scalar metrics.",
        "prioritate": "P2"
    },
    {
        "id_task": "F3.9.11",
        "denumire_task": "SearchInput cu Autocomplete",
        "descriere_task": "SearchInput avansat. Props: value, onChange, onSearch, suggestions, debounceMs, loading, recentSearches. Features: debounce, dropdown sugestions, keyboard nav, recent searches.",
        "cale_implementare": "/apps/web-admin/app/components/ui/SearchInput.tsx",
        "contextul_anterior": "useRecentSearches hook există (F3.5), UI lipsește.",
        "validare_task": "SearchInput cu 20 suggestions, keyboard nav, debounce works.",
        "outcome_task": "Search experience enterprise-grade.",
        "restrictii_antihalucinatie": "Folosiți Polaris Autocomplete pattern.",
        "prioritate": "P0"
    },
    {
        "id_task": "F3.9.12",
        "denumire_task": "DateRangePicker Component",
        "descriere_task": "DateRangePicker. Props: value, onChange, minDate, maxDate, presets, locale. Features: dual calendar, presets, keyboard nav. Presets: Today, Last 7 days, This month, etc.",
        "cale_implementare": "/apps/web-admin/app/components/ui/DateRangePicker.tsx",
        "contextul_anterior": "Nicio componentă date picker în documentație.",
        "validare_task": "DateRangePicker cu presets, range selection, responsive.",
        "outcome_task": "Date filtering pentru reports.",
        "restrictii_antihalucinatie": "Folosiți react-day-picker.",
        "prioritate": "P1"
    },
    {
        "id_task": "F3.9.13",
        "denumire_task": "MultiSelect cu Tags",
        "descriere_task": "MultiSelect component. Props: value, onChange, options, maxItems, allowCreate, searchable. Features: tags în input, dropdown cu checkboxes, keyboard nav.",
        "cale_implementare": "/apps/web-admin/app/components/ui/MultiSelect.tsx",
        "contextul_anterior": "Polaris are Select dar nu multi-select avansat.",
        "validare_task": "MultiSelect cu 50 options, search, create new.",
        "outcome_task": "Multi-value selection.",
        "prioritate": "P1"
    },
    {
        "id_task": "F3.9.14",
        "denumire_task": "FileUpload cu Drag and Drop",
        "descriere_task": "FileUpload component. Props: onUpload, accept, maxSize, maxFiles, preview. Features: drag & drop, validation, progress bars, thumbnails.",
        "cale_implementare": "/apps/web-admin/app/components/ui/FileUpload.tsx",
        "contextul_anterior": "Import UI (F6.6.4) necesită file upload.",
        "validare_task": "FileUpload acceptă 5 files, drag-drop, progress, validation.",
        "outcome_task": "File upload UX modern.",
        "restrictii_antihalucinatie": "Folosiți react-dropzone.",
        "prioritate": "P1"
    }
    ]
    ```

## Faza F4: Infrastructura de procesare asincronă (Săptămâna 4)

Durată: Săptămâna 4
Obiectiv: BullMQ Pro + fairness multi-tenant + rate limiting distribuit Shopify (cost-based) + worker hardening + observabilitate completă.

**Aliniere cu F0–F3:** Redis există din F1.2, enqueue minim există din F3.3.3, OTel există din F3.4. În F4 standardizăm infrastructura async, activăm BullMQ Pro Groups, rate limiting corect Shopify și hardening operațional.

### F4.1: Configurare cozi distribuite BullMQ Pro (foundation + refactor din F3)

    ```JSON
    [
    {
        "id_task": "F4.1.1",
        "denumire_task": "Bootstrap queue-manager + conexiune Redis",
        "descriere_task": "Creează pachetul `@app/queue-manager` cu infrastructură de bază:\n\n- Conexiune Redis (client recomandat pentru BullMQ: ioredis)\n- Config standard: timeouts, retries defaults\n- Factory functions pentru Queue/Worker\n- Export tipuri pentru job payloads\n\n**Livrabil:** Pachet infrastructură fără logică business.",
        "cale_implementare": "/Neanelu_Shopify/packages/queue-manager/src",
        "contextul_anterior": "Redis 8.4 rulează în Docker din F1.2; webhooks au enqueue minim din F3.3.3.",
        "validare_task": "Pornești o coadă 'test-queue' + worker, job-ul este procesat end-to-end.",
        "outcome_task": "Infrastructură cozi funcțională, standardizată.",
        "restrictii_antihalucinatie": "Nu amesteca logica business în queue-manager; doar infrastructură. Nu hardcoda config."
    },
    {
        "id_task": "F4.1.2",
        "denumire_task": "Integrare BullMQ Pro (install + verificare registry privat)",
        "descriere_task": "**CONFORM Docs (secrets management):** Instalează @taskforcesh/bullmq-pro din registry privat.\n\n**Cerințe:**\n- .npmrc: `@taskforcesh:registry=https://npm.taskforce.sh/` + `//npm.taskforce.sh/:_authToken=${NPM_TASKFORCESH_TOKEN}`\n- package.json: `@taskforcesh/bullmq-pro` ca dependency\n- CI: token din GitHub Actions secrets (nu hardcodat)\n- Fallback: dacă token lipsește în contexte dev, build nu blochează (gating clar)\n\n**Validare:** `pnpm install` reușește local cu token și în CI.",
        "cale_implementare": "/Neanelu_Shopify/packages/queue-manager/package.json + .npmrc + CI config",
        "contextul_anterior": "F0 definește secrets management; NPM_TASKFORCESH_TOKEN e în .env.example.",
        "validare_task": "1) pnpm install local cu NPM_TASKFORCESH_TOKEN setat\n2) CI pipeline reușește cu secrets\n3) Import @taskforcesh/bullmq-pro funcționează",
        "outcome_task": "BullMQ Pro instalabil reproducibil în toate mediile.",
        "restrictii_antihalucinatie": "NU comite token-uri în repo. NU schimba package manager (rămâne pnpm)."
    },
    {
        "id_task": "F4.1.3",
        "denumire_task": "Taxonomie cozi + contracte standard (naming, options, retenție)",
        "descriere_task": "Definește lista standard de cozi și opțiunile lor:\n\n**Cozi:**\n- `webhook-queue` - evenimente Shopify\n- `sync-queue` - sincronizări incrementale\n- `bulk-queue` - bulk operations orchestration\n- `ai-batch-queue` - procesare AI/embeddings\n\n**Default options:**\n- attempts: 3, backoff: exponential\n- removeOnComplete: { age: 86400 } (24h)\n- removeOnFail: { age: 604800 } (7 zile pentru debugging)\n- timeout standardizat per tip job",
        "cale_implementare": "/Neanelu_Shopify/packages/queue-manager/src/queues",
        "contextul_anterior": "F3.3.2 definește contract payload minim; acum standardizăm cozile.",
        "validare_task": "Inspectezi job-urile în Redis și confirmi retenția/curățarea conform politicii.",
        "outcome_task": "Taxonomie clară, opțiuni predictibile, cleanup automat.",
        "restrictii_antihalucinatie": "Fără payload mare în job data; payload minim + pointer/TTL (aliniat cu F3.3.2)."
    },
    {
        "id_task": "F4.1.4",
        "denumire_task": "DLQ + politică de retry (anti-storm, predictibil)",
        "descriere_task": "Implementează politica de retry și Dead Letter Queue:\n\n**Reguli:**\n- Max 3 attempts cu backoff exponential (1s, 4s, 16s)\n- După 3 fails → job în DLQ (coadă separată `*-dlq`)\n- Metadata păstrată pentru debugging (originalQueue, failReason, attempts)\n- Alert/metric la DLQ entry\n\n**DLQ handling:**\n- Manual inspection/re-queue\n- Auto-purge după 30 zile (configurable)",
        "cale_implementare": "/Neanelu_Shopify/packages/queue-manager/src/policies",
        "contextul_anterior": "Cozi standard există; trebuie politică clară pentru failures.",
        "validare_task": "Simulezi eșec repetat → job ajunge în DLQ, fără retry infinit, metadata prezentă.",
        "outcome_task": "Failures controlate, debugging posibil, fără retry storm.",
        "restrictii_antihalucinatie": "NU introduce retry infinit. NU ascunde erorile (log + metric obligatoriu)."
    },
    {
        "id_task": "F4.1.5",
        "denumire_task": "Refactor: mută enqueue-ul minim din F3 în queue-manager",
        "descriere_task": "**Completează promisiunea din F3.3.3:** Migrează codul de enqueue din apps/backend-worker/src/queue către packages/queue-manager.\n\n**Livrabil:**\n- Endpoint-ul webhooks folosește @app/queue-manager ca producer\n- Codul 'bootstrap' din F3.3.3 devine thin wrapper sau dispare\n- Semantica răspunsului webhook rămâne neschimbată (rapid)",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/queue → /Neanelu_Shopify/packages/queue-manager/src",
        "contextul_anterior": "F3.3.3 a creat enqueue minim cu promisiunea de refactor în F4.1. **CONTINUARE STRATEGIE INCREMENTALĂ:** Aceasta este partea 2 a strategiei: săptămâna 3 = cod inline (funcționalitate rapidă), săptămâna 4 = refactorizare (calitate cod). Contractul API `enqueueWebhookJob(payload)` definit în F3.3.3 TREBUIE păstrat pentru a nu sparge codul existent. Refactorizarea mută implementarea, nu schimbă interfața.",
        "validare_task": "Webhook ingress → enqueue funcționează identic, dar prin @app/queue-manager.",
        "outcome_task": "Single source of truth pentru queue infrastructure; eliminare dubluri.",
        "restrictii_antihalucinatie": "NU schimba semantica răspunsului webhook. NU introduce dependență circulară."
    },
    {
        "id_task": "F4.1.6",
        "denumire_task": "Worker lifecycle hardening (QueueScheduler/Events, graceful shutdown)",
        "descriere_task": "Implementează robustețe operațională pentru workers:\n\n**Cerințe:**\n- QueueScheduler pentru delayed jobs (dacă BullMQ Pro nu auto-handles)\n- QueueEvents pentru monitoring stalled/failed\n- Stalled job detection + recovery\n- Graceful shutdown pe SIGTERM:\n  - Nu acceptă job-uri noi\n  - Așteaptă finalizarea job-urilor active (timeout)\n  - Nu pierde job-uri în procesare",
        "cale_implementare": "/Neanelu_Shopify/packages/queue-manager/src/workers + apps/backend-worker/src",
        "contextul_anterior": "Workers există dar fără hardening operațional.",
        "validare_task": "Oprești procesul în timpul unui job → comportament controlat (retries/stalled recovery), fără job-uri pierdute.",
        "outcome_task": "Workers robuște pentru producție.",
        "restrictii_antihalucinatie": "NU folosi 'sleep activ'; folosește mecanismele BullMQ (delay/backoff)."
    },
    {
        "id_task": "F4.1.7",
        "denumire_task": "Health/readiness pentru worker + verificări operaționale",
        "descriere_task": "Extinde healthcheck-ul pentru a include starea worker-ului:\n\n**/healthz include:**\n- Redis reachable\n- Worker active (nu crashed)\n- Queue-uri funcționale\n\n**Fără detalii sensibile în răspuns.**",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/routes + config",
        "contextul_anterior": "F3.1.1 a creat healthz de bază; acum îl extindem pentru workers.",
        "validare_task": "Health trece când Redis e up; eșuează controlat când Redis e down.",
        "outcome_task": "Observabilitate operațională pentru orchestrator (k8s/docker).",
        "restrictii_antihalucinatie": "Nu expune internals public fără auth."
    },
    {
        "id_task": "F4.1.8",
        "denumire_task": "Teste de integrare pentru queue-manager (node:test)",
        "descriere_task": "Adaugă teste automate pentru infrastructura de cozi:\n\n**Teste:**\n- Queue + Worker end-to-end\n- Retry policy funcționează\n- DLQ population\n- Retenție/cleanup\n\n**Rulează în CI cu Redis ephemeral.**",
        "cale_implementare": "/Neanelu_Shopify/packages/queue-manager/src/__tests__",
        "contextul_anterior": "F1.4 definește CI; infrastructura trebuie testată automat.",
        "validare_task": "Rulează teste local și în CI; pass obligatoriu pentru merge.",
        "outcome_task": "Infrastructură cozi acoperită de teste.",
        "restrictii_antihalucinatie": "NU folosi Jest."
    }
    ]
    ```

### F4.2: Fairness multi-tenant (BullMQ Pro Groups + aliniere cu RLS runtime)

    ```JSON
    [
    {
        "id_task": "F4.2.1",
        "denumire_task": "Implementare Groups fairness (round-robin între shops)",
        "descriere_task": "**CONFORM Docs (BullMQ Pro Groups):** Configurează workers cu Groups pentru fairness.\n\n**Implementare:**\n- Worker config cu `group: { id: shopId }`\n- Round-robin între grupuri (fără starvation)\n- Limitare concurență per shop: `limiter: { max: 2, groupKey: 'shopId' }`\n- Concurență globală: MAX_GLOBAL_CONCURRENCY (ex: 50 job slots), rulată pe 10 instanțe worker Docker în prod (batch processing)",
        "cale_implementare": "/Neanelu_Shopify/packages/queue-manager/src/strategies/fairness",
        "contextul_anterior": "Cozi standard există; fără fairness un tenant poate monopoliza.",
        "validare_task": "Două shops cu backlog mare → procesare intercalată echitabil (nu secvențial).",
        "outcome_task": "Procesare echitabilă multi-tenant, fără noisy neighbor.",
        "restrictii_antihalucinatie": "Nu implementa manual ce BullMQ Pro oferă nativ (Groups)."
    },
    {
        "id_task": "F4.2.2",
        "denumire_task": "Cheie de grup (groupId) standard + validare/canonicalizare",
        "descriere_task": "Definește regula clară pentru groupId:\n\n**Standard:** `groupId = shop_id` (UUIDv7 canonical)\n\n**Validare:**\n- Job fără shop valid e respins înainte de enqueue\n- Nu permite wildcard/null\n- Canonicalizare pentru evitarea coliziunilor",
        "cale_implementare": "/Neanelu_Shopify/packages/queue-manager/src/strategies/fairness",
        "contextul_anterior": "Groups necesită groupId consistent.",
        "validare_task": "Job cu shopId invalid e respins înainte de enqueue.",
        "outcome_task": "GroupId predictibil și valid în toate cazurile.",
        "restrictii_antihalucinatie": "NU folosi groupId cu cardinalitate explozivă (ex: productId)."
    },
    {
        "id_task": "F4.2.3",
        "denumire_task": "Config centralizat pentru limite (nu hardcode)",
        "descriere_task": "Externalizează limitele în config:\n\n**Environment variables:**\n- MAX_ACTIVE_PER_SHOP (default: 2)\n- MAX_GLOBAL_CONCURRENCY (default: 50)\n- STARVATION_TIMEOUT_MS (default: 60000)\n\n**Valori default safe, overridable per mediu.**",
        "cale_implementare": "/Neanelu_Shopify/packages/config + packages/queue-manager",
        "contextul_anterior": "F3.1.2 definește contract env; limitele trebuie externalizate.",
        "validare_task": "Poți modifica limitele fără cod changes (doar env).",
        "outcome_task": "Configurabilitate runtime pentru tuning producție.",
        "restrictii_antihalucinatie": "Nu hardcoda valori în cod."
    },
    {
        "id_task": "F4.2.4",
        "denumire_task": "Wrapper obligatoriu de shop context pentru job processing (RLS enforcement)",
        "descriere_task": "**Completează F3.2.4 pentru job processing:** Orice processor care accesează DB rulează cu shop context setat.\n\n**Implementare:**\n```typescript\nawait withShopContext(job.data.shopId, async () => {\n  // DB queries aici - RLS activ\n});\n```\n\n**Interzis:** Query DB fără SET LOCAL.",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors + packages/database",
        "contextul_anterior": "F3.2.4 definește withShopContext; F4 îl impune în job processing.",
        "validare_task": "Test integrare: job shop A urmat de job shop B pe același worker → zero leak cross-tenant.",
        "outcome_task": "RLS enforcement complet la nivel de job processing.",
        "restrictii_antihalucinatie": "INTERZIS query multi-tenant fără SET LOCAL în job processors."
    },
    {
        "id_task": "F4.2.5",
        "denumire_task": "Prioritizare minimă pentru tipuri de job (critical vs bulk)",
        "descriere_task": "Implementează prioritizare pentru job-uri critice:\n\n**Nivele:**\n- priority: 1 - CRITICAL (app/uninstalled, auth events)\n- priority: 5 - NORMAL (webhooks standard)\n- priority: 10 - BULK (sync/ingest masiv)\n\n**Semantic:** Critical nu stă în spatele bulk backlog.",
        "cale_implementare": "/Neanelu_Shopify/packages/queue-manager/src/queues",
        "contextul_anterior": "F3.3.5 definește app/uninstalled ca handler obligatoriu; trebuie procesabil rapid.",
        "validare_task": "Job critical se procesează înaintea backlog-ului bulk.",
        "outcome_task": "Evenimente critice procesate prompt.",
        "restrictii_antihalucinatie": "Nu transforma prioritizarea într-un escape hatch care anulează fairness."
    },
    {
        "id_task": "F4.2.6",
        "denumire_task": "Test automat fairness/no-starvation",
        "descriere_task": "Adaugă test de integrare pentru fairness:\n\n**Test:**\n- Injectează N job-uri în 2 grupuri (shopA: 100, shopB: 10)\n- Verifică intercalare (shopB nu așteaptă 100 job-uri)\n- Verifică timp maxim de așteptare rezonabil",
        "cale_implementare": "/Neanelu_Shopify/packages/queue-manager/src/__tests__",
        "contextul_anterior": "Fairness trebuie validată automat, nu manual.",
        "validare_task": "Test determinist (nu flaky); rulează în CI.",
        "outcome_task": "Fairness garantată prin test automat.",
        "restrictii_antihalucinatie": "Test trebuie să fie determinist."
    }
    ]
    ```

### F4.3: Rate limiting distribuit (Shopify cost-based + 429 + backoff corect)

    ```JSON
    [
    {
        "id_task": "F4.3.1",
        "denumire_task": "Specificație tehnică rate limiting Shopify (model + semnale)",
        "descriere_task": "**Documentează explicit modelul de rate limiting Shopify:**\n\n**GraphQL:**\n- Cost-based (nu requests/sec)\n- Semnale: `extensions.cost.throttleStatus` (currentlyAvailable, maximumAvailable, restoreRate)\n- Action: delay bazat pe restoreRate dacă currentlyAvailable < costNecesar\n\n**REST:**\n- Request-based + 429 Retry-After\n- Action: respectă Retry-After header\n\n**Bulk Operations:**\n- Concurrency limit: 1 bulk activ per shop\n- Nu e 'rate limit' ci 'concurrency limit'",
        "cale_implementare": "/Neanelu_Shopify/packages/shopify-client/src/rate-limiting.ts + docs",
        "contextul_anterior": "F4.3 era sub-specificat pentru specificul Shopify.",
        "validare_task": "Documentația și codul reflectă toate cele 3 modele.",
        "outcome_task": "Model clar de rate limiting pentru fiecare tip de API Shopify.",
        "restrictii_antihalucinatie": "NU trata GraphQL și REST identic. NU confunda rate limit cu bulk concurrency."
    },
    {
        "id_task": "F4.3.2",
        "denumire_task": "Lua script atomic în Redis pentru buget per shop (cost bucket)",
        "descriere_task": "Implementează rate limiter atomic în Redis:\n\n**Script Lua:**\n- Check current budget per shop\n- Consume cost points\n- Return: allowed/delayed + delay_ms\n- Restore rate consistent cu Shopify (50 points/sec typical)\n\n**Atomicitate:** Fără race conditions la concurență mare.",
        "cale_implementare": "/Neanelu_Shopify/packages/queue-manager/src/strategies/fairness/rate-limiter.lua + wrapper TS",
        "contextul_anterior": "Fairness e implementată; acum controlăm și limitele Shopify per shop.",
        "validare_task": "Concurență mare → nu apar 'double spend' / negative budgets.",
        "outcome_task": "Rate limiting atomic și corect.",
        "restrictii_antihalucinatie": "Nu implementa sleep activ; doar returnezi delay."
    },
    {
        "id_task": "F4.3.3",
        "denumire_task": "Integrare limiter în execuția job-urilor Shopify API",
        "descriere_task": "Integrează rate limiter în workflow-ul de job processing:\n\n**Înainte de orice call Shopify:**\n1. Verifică buget disponibil (via Lua)\n2. Dacă suficient → consume și proceed\n3. Dacă insuficient → job delayed cu timp calculat\n\n**BullMQ Pro integration:** Folosește `rateLimitGroup` unde posibil.",
        "cale_implementare": "/Neanelu_Shopify/packages/shopify-client + packages/queue-manager",
        "contextul_anterior": "Lua script există; trebuie integrat în flow.",
        "validare_task": "Sub load, nu depășești limitele, nu intri în retry storm.",
        "outcome_task": "Rate limiting end-to-end pentru Shopify API.",
        "restrictii_antihalucinatie": "Limiter e per shop (nu global)."
    },
    {
        "id_task": "F4.3.4",
        "denumire_task": "Backoff corect la THROTTLED/429 (delay derivat din răspuns)",
        "descriere_task": "Implementează backoff inteligent bazat pe răspunsul Shopify:\n\n**429 (REST):**\n- Citește Retry-After header\n- Delay = Retry-After seconds\n\n**THROTTLED (GraphQL):**\n- Citește throttleStatus.currentlyAvailable și restoreRate\n- Delay = (costNecesar - currentlyAvailable) / restoreRate * 1000ms\n\n**Fallback:** Dacă headers lipsesc, exponential backoff.",
        "cale_implementare": "/Neanelu_Shopify/packages/queue-manager + packages/shopify-client",
        "contextul_anterior": "Rate limiter proactiv există; trebuie și reactive backoff.",
        "validare_task": "Test: răspuns 429 → job amânat exact conform Retry-After.",
        "outcome_task": "Backoff inteligent, nu 'blind delay'.",
        "restrictii_antihalucinatie": "NU hardcode delay fix."
    },
    {
        "id_task": "F4.3.5",
        "denumire_task": "Semaphore/lock per shop pentru Bulk Operations (concurență 1) - INTEGRAT CU FAIRNESS",
        "descriere_task": "**CONFORM AUDIT 2025-12-26:** Implementează lock distribuit pentru Bulk Operations, INTEGRAT cu BullMQ Groups pentru consistență cu fairness multi-tenant:\n\n**Reguli:**\n- 1 bulk activ per shop la un moment dat\n- Lock cu TTL (+ renew dacă e necesar)\n- Al doilea job bulk așteaptă/delayed până lock-ul e eliberat\n\n**INTEGRARE CU FAIRNESS (F4.2 Groups):**\n- Lock-ul folosește **group ID (shopId)** pentru consistență cu fairness\n- Key pattern: `bulk-lock:${shopId}` aliniat cu BullMQ group ID\n- Când lock-ul e activ pentru un shop, alte jobs din același group așteaptă\n- Jobs din alte groups (alte shops) NU sunt afectate\n\n**Redis implementation:**\n```lua\n-- Lua script pentru atomic lock cu group awareness\nlocal lockKey = 'bulk-lock:' .. KEYS[1] -- shopId\nlocal groupKey = 'bullmq:groups:' .. KEYS[1]\nlocal ttl = tonumber(ARGV[1]) or 1800000 -- 30 min default\n\nif redis.call('SET', lockKey, ARGV[2], 'NX', 'PX', ttl) then\n  return 1 -- Lock acquired\nelse\n  return 0 -- Lock exists, job should wait\nend\n```\n\n**Verificare consistență:**\n- Lock key și group key TREBUIE să folosească același shopId\n- Nu există race condition deoarece ambele operații sunt per-shop",
        "cale_implementare": "/Neanelu_Shopify/packages/queue-manager/src/locks",
        "contextul_anterior": "F4.2 definește BullMQ Groups per shopId. Lock-ul TREBUIE să fie aliniat.",
        "validare_task": "1. Două job-uri bulk simultane pentru același shop → al doilea așteaptă\n2. Job-uri pentru shops diferite → procesare paralelă (nu se blochează reciproc)\n3. Lock key pattern matches group key pattern",
        "outcome_task": "Concurrency control pentru bulk ops, integrat cu fairness multi-tenant.",
        "restrictii_antihalucinatie": "Lock-ul NU trebuie să blocheze alte shops (aliniat cu fairness). shopId din lock TREBUIE să fie identic cu groupId din BullMQ."
    },
    {
        "id_task": "F4.3.6",
        "denumire_task": "Teste integrare rate limiting + lock",
        "descriere_task": "Adaugă teste pentru rate limiting și locking:\n\n**Teste:**\n- Lua script atomicity\n- Backoff corect la 429/THROTTLED\n- Lock bulk operations\n- No race conditions\n\n**Rulează în CI cu Redis real (container).**",
        "cale_implementare": "/Neanelu_Shopify/packages/queue-manager/src/__tests__",
        "contextul_anterior": "Rate limiting e critic; trebuie testat automat.",
        "validare_task": "Teste pass în CI.",
        "outcome_task": "Rate limiting validat automat.",
        "restrictii_antihalucinatie": "Fără dependență de Shopify real (mock răspunsuri)."
    }
    ]
    ```

### F4.4: Observabilitate cozi & worker (OTel, metrici, loguri)

    ```JSON
    [
    {
        "id_task": "F4.4.1",
        "denumire_task": "Spans pentru lifecycle job (enqueue/dequeue/process/retry/fail)",
        "descriere_task": "Instrumentează lifecycle-ul job-urilor cu spans OTel:\n\n**Spans:**\n- `queue.enqueue` - când job e adăugat\n- `queue.dequeue` - când worker preia job\n- `queue.process` - durata procesării\n- `queue.retry` - când se face retry\n- `queue.fail` - când job eșuează definitiv\n\n**Propagare:** Trace context din ingress (F3.4) → job processing.",
        "cale_implementare": "/Neanelu_Shopify/packages/queue-manager/src/otel + apps/backend-worker/src",
        "contextul_anterior": "F3.4 a introdus OTel; acum extindem pentru jobs.",
        "validare_task": "Trace complet webhook → enqueue → worker → DB vizibil în Jaeger.",
        "outcome_task": "Observabilitate end-to-end pentru jobs.",
        "restrictii_antihalucinatie": "Sampling rezonabil (10% prod)."
    },
    {
        "id_task": "F4.4.2",
        "denumire_task": "Metrici operaționale minime pentru cozi",
        "descriere_task": "Expune metrici pentru cozi (convenție unică `queue_*`):\n\n**Metrici:**\n- `queue_depth` - jobs waiting per queue (label: queue_name)\n- `queue_active` - jobs currently executing (label: queue_name)\n- `queue_job_latency_seconds` - time from enqueue to start (label: queue_name)\n- `queue_job_duration_seconds` - processing time (label: queue_name)\n- `queue_job_failed_total` - terminal failures (label: queue_name)\n- `queue_job_stalled_total` - stalled jobs count (label: queue_name)\n- `queue_dlq_entries_total` - jobs moved to DLQ (label: queue_name)\n\nNOTĂ: retry/backoff/rate-limit sunt semnale în logs/spans; metrici suplimentare se pot adăuga ulterior fără cardinalitate mare.",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/otel/metrics.ts + /Neanelu_Shopify/apps/backend-worker/src/processors/* + /Neanelu_Shopify/packages/queue-manager/src",
        "contextul_anterior": "Traces există; metrici necesare pentru alerting/SLO.",
        "validare_task": "Metrici vizibile în exporter; grafice funcționale.",
        "outcome_task": "Bază pentru alerting și SLO monitoring.",
        "restrictii_antihalucinatie": "NU folosi shop_domain ca label de metric (cardinalitate mare); shop info rămâne în traces/logs."
    },
    {
        "id_task": "F4.4.3",
        "denumire_task": "Loguri structurate pentru worker (corelate cu traceId)",
        "descriere_task": "Extinde logging-ul pentru workers:\n\n**Log events standard:**\n- job.start (jobId, queueName, attempt, shopId)\n- job.complete (jobId, duration)\n- job.fail (jobId, error, attempt)\n- job.retry (jobId, attempt, backoffMs)\n\n**Corelat cu traceId/spanId.**",
        "cale_implementare": "/Neanelu_Shopify/packages/logger + packages/queue-manager",
        "contextul_anterior": "F3.1.4 și F3.4.2 au introdus logging corelat; extindem pentru workers.",
        "validare_task": "Loguri conțin jobId, queueName, traceId pentru fiecare event.",
        "outcome_task": "Debugging rapid pentru job issues.",
        "restrictii_antihalucinatie": "Fără PII, fără payload complet în loguri."
    },
    {
        "id_task": "F4.4.4",
        "denumire_task": "Observabilitate pentru fairness și rate limit",
        "descriere_task": "Adaugă semnale explicite pentru fairness și rate limiting:\n\n**Events/Metrics:**\n- `fairness.group_delayed` - grup amânat\n- `ratelimit.throttled` - job throttled\n- `ratelimit.backoff_applied` - backoff aplicat\n- `bulk.lock_contention` - lock contention\n- (opțional) `fairness.starvation_guard` - dacă implementezi",
        "cale_implementare": "/Neanelu_Shopify/packages/queue-manager/src/otel",
        "contextul_anterior": "Fairness și rate limiting există; trebuie observabilitate dedicată.",
        "validare_task": "Când simulezi throttling, vezi metrics/spans dedicate.",
        "outcome_task": "Vizibilitate în comportamentul de fairness/throttling.",
        "restrictii_antihalucinatie": "Nu adăuga cardinalitate mare în metrics."
    },
    {
        "id_task": "F4.4.5",
        "denumire_task": "Test smoke pentru telemetry (dev)",
        "descriere_task": "Creează smoke test pentru observabilitate:\n\n**Script:**\n- Generează câteva job-uri\n- Verifică export în Jaeger\n- Verifică metrici\n\n**Fallback:** Observabilitatea nu e obligatorie pentru runtime (fallback silențios dacă exporter lipsește, aliniat cu F3.4.1).",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/__tests__/otel-smoke.test.ts",
        "contextul_anterior": "OTel e configurat; trebuie validat că funcționează.",
        "validare_task": "Smoke test pass în dev cu Jaeger running.",
        "outcome_task": "Verificare automată că telemetry funcționează.",
        "restrictii_antihalucinatie": "Fallback silențios dacă exporter lipsește."
    }
    ]
    ```

### F4.5: UI Monitorizare Cozi Detaliată

    ```JSON
    [
    {
        "id_task": "F4.5.1",
        "denumire_task": "Queue UI: Tab 'Metrici' (Recharts)",
        "descriere_task": "Implementează `Tabs` layout în `app.queues.tsx`. Tab 1: Line Chart pentru Throughput (Jobs/sec) și Pie Chart pentru Status Distribution (Active/Failed/Wait). Folosește date reale din loader (API Backend).",
        "cale_implementare": "/apps/web-admin/app/routes/app.queues.tsx",
        "contextul_anterior": "Backend F4 gata.",
        "validare_task": "Graficele randează axe și tooltip-uri.",
        "outcome_task": "Vizualizare metrici.",
        "restrictii_antihalucinatie": "Line Chart are referință roșie la limită."
    },
    {
        "id_task": "F4.5.2",
        "denumire_task": "Queue UI: Tab 'Jobs List' (Table & Filters)",
        "descriere_task": "Tab 2: Toolbar cu Search Input (by ID) și Filter Select. Tabel cu coloanele: ID (copyable), Payload (truncate), Progress (bar), Status (Badge), Actions (Dropdown). Implementează logica de filtrare client-side sau server-side.",
        "cale_implementare": "/apps/web-admin/app/components/domain/jobs-table.tsx",
        "contextul_anterior": "Metrici gata.",
        "validare_task": "Tabelul listează joburi.",
        "outcome_task": "Listare joburi.",
        "restrictii_antihalucinatie": "Dropdown Actions include Retry și Delete."
    },
    {
        "id_task": "F4.5.3",
        "denumire_task": "Queue UI: Actiuni & Dialoguri Confirmare",
        "descriere_task": "Conectează acțiunile din tabel: Retry trimite POST request și afișează Success Toast. Delete deschide `AlertDialog`: 'Această acțiune este ireversibilă'. Confirmarea șterge jobul și face refresh la listă.",
        "cale_implementare": "/apps/web-admin/app/routes/app.queues.tsx",
        "contextul_anterior": "Tabel gata.",
        "validare_task": "Workflow-ul de ștergere fuctionează end-to-end.",
        "outcome_task": "Interactivitate completă.",
        "restrictii_antihalucinatie": "AlertDialog obligatoriu pentru Delete."
    },
    {
        "id_task": "F4.5.4",
        "denumire_task": "Queue: Tab Workeri Activi (din documentația UI)",
        "descriere_task": "Implementează Tab 3 'Workeri' în app.queues.tsx: Grid layout cu cards per worker. Fiecare card conține: status badge (Online/Offline cu culori verde/gri), current job (ID + progress), metrici CPU/MEM (mini gauges sau text). Auto-refresh la 5 secunde folosind usePolling hook sau loader revalidation.",
        "cale_implementare": "/apps/web-admin/app/routes/app.queues.tsx + /apps/web-admin/app/components/domain/worker-card.tsx",
        "contextul_anterior": "F4.5.1-3 au implementat Metrici și Jobs List. Backend expune /api/queues/workers.",
        "validare_task": "Grid afișează cards pentru fiecare worker activ cu status real-time.",
        "outcome_task": "Vizibilitate asupra workerilor activi și sarcinilor curente.",
        "restrictii_antihalucinatie": "Nu hardcoda numărul de workeri. Badge Online = verde, Offline = gri.",
        "prioritate": "P2"
    },
    {
        "id_task": "F4.5.5",
        "denumire_task": "Queue: WebSocket pentru real-time updates",
        "descriere_task": "Implementează conectare WebSocket la /api/queues/ws pentru actualizări live. Elimină nevoia de polling pentru status updates. Implementează reconnect logic cu exponential backoff (1s, 2s, 4s, max 30s). Event handlers pentru: job.started, job.completed, job.failed, worker.online, worker.offline.",
        "cale_implementare": "/apps/web-admin/app/hooks/use-queue-stream.ts + /apps/web-admin/app/routes/app.queues.tsx",
        "contextul_anterior": "Backend F4.4 expune stream endpoint. Frontend folosește polling ineficient.",
        "validare_task": "Statusurile se actualizează instant fără refresh manual. Reconectare automată după disconnect.",
        "outcome_task": "UX fluid cu zero lag perceptibil pentru status changes.",
        "restrictii_antihalucinatie": "Obligatoriu exponential backoff pentru reconnect. Nu polling ca fallback permanent.",
        "prioritate": "P1 - CRITIC pentru UX"
    },
    {
        "id_task": "F4.5.6",
        "denumire_task": "Queue: Pagination/Virtual scroll pentru jobs list",
        "descriere_task": "Pentru liste mari (>1000 jobs), implementează cursor-based pagination sau react-window pentru virtual scrolling. Loader-ul acceptă params: cursor, limit (default 50). Afișează 'Load more' button sau infinite scroll. Pentru virtual scrolling: folosește FixedSizeList din react-window cu row height 48px.",
        "cale_implementare": "/apps/web-admin/app/components/domain/jobs-table.tsx + /apps/web-admin/app/routes/app.queues.tsx (loader)",
        "contextul_anterior": "Tabelul curent încarcă toate joburile - probleme de performanță la scală.",
        "validare_task": "Testează cu 5000+ jobs - UI rămâne responsive (<16ms frame time).",
        "outcome_task": "Performanță stabilă indiferent de numărul de joburi.",
        "restrictii_antihalucinatie": "Nu încărca >100 jobs per request. Virtual scroll necesită height fix pe container.",
        "prioritate": "P2"
    },
    {
        "id_task": "F4.5.7",
        "denumire_task": "Queue: Bulk Actions (select multiple, retry all, delete all)",
        "descriere_task": "Adaugă checkbox în fiecare rând din jobs table + checkbox 'Select all' în header. Toolbar contextual apare când items selectate > 0: afișează count, dropdown cu acțiuni (Retry Selected, Delete Selected). Pentru Delete: AlertDialog de confirmare cu mesaj 'Ștergi X joburi?'. Backend batch endpoint: POST /api/queues/jobs/batch cu { action: 'retry'|'delete', ids: [] }.",
        "cale_implementare": "/apps/web-admin/app/components/domain/jobs-table.tsx + /apps/web-admin/app/routes/app.queues.tsx (action)",
        "contextul_anterior": "Actualmente doar acțiuni per job individual - ineficient pentru cleanup.",
        "validare_task": "Selectează 10 joburi, apasă Delete, confirmă - toate sunt șterse într-un singur request.",
        "outcome_task": "Operațiuni eficiente la scală pentru gestionarea cozilor.",
        "restrictii_antihalucinatie": "AlertDialog OBLIGATORIU pentru delete. Limit max 100 items per batch.",
        "prioritate": "P2"
    },
    {
        "id_task": "F4.5.8",
        "denumire_task": "Queue: Job Detail Modal (full payload, timeline, logs)",
        "descriere_task": "Click pe job ID → deschide modal/drawer cu: (1) Payload complet - JSON viewer cu syntax highlighting și expand/collapse, (2) Timeline - lista de evenimente: created, started, attempts[], failed/completed at, (3) Logs inline - dacă există, afișate în LogConsole component. Buton 'Copy Payload' pentru debugging.",
        "cale_implementare": "/apps/web-admin/app/components/domain/job-detail-modal.tsx + /apps/web-admin/app/routes/app.queues.tsx",
        "contextul_anterior": "Tabelul afișează doar payload truncat - debugging dificil.",
        "validare_task": "Click pe job → modal cu toate datele. Copy payload funcționează.",
        "outcome_task": "Debugging complet fără acces direct la Redis/DB.",
        "restrictii_antihalucinatie": "JSON viewer trebuie să gestioneze payload-uri mari (>100KB) fără lag.",
        "prioritate": "P2"
    }
    ]
    ```

## Faza F5: Pipeline-ul de ingestie „Stitched" (Săptămâna 6-7)

Durată: Săptămâna 6–7
Obiectiv: Bulk Operations complet (query + mutation) + streaming JSONL + COPY în Postgres cu staging tables + observabilitate completă + teste enterprise.

**Prerechizite din F0-F4:**

- F1.2: Redis 8.4 + Postgres 18.1 în Docker
- F2.2: Tabela `bulk_runs` cu RLS
- F3.2: Shopify Auth + tokens
- F4.1: BullMQ Pro + queue-manager
- F4.2: Fairness (Groups) + withShopContext wrapper
- F4.3.5: Lock distribuit "1 bulk activ per shop"
- F4.4: OTel spans/metrics

### F5.1: Orchestrare Shopify Bulk Ops (query + mutation, multi-tenant safe)

    ```JSON
    [
    {
        "id_task": "F5.1.1",
        "denumire_task": "Orchestrator Bulk Operations (runQuery/runMutation)",
        "descriere_task": "Implementează orchestratorul central pentru Shopify Bulk Operations:\n\n**Entry points:**\n- `startBulkQuery(shopId, queryType)` - pentru Core/Meta/Inventory\n- `startBulkMutation(shopId, mutationType, inputPath)` - pentru writes\n\n**Integrare BullMQ Pro Groups:**\n- Job adăugat în coadă cu `group: { id: shopId }`\n- Processor consumă din `@app/queue-manager`\n\n**Persistență:**\n- Crează înregistrare în `bulk_runs` la start\n- Actualizează status pe tot lifecycle-ul",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/orchestrator.ts",
        "contextul_anterior": "F3 are auth Shopify; F4 are BullMQ Pro + Groups + lock.",
        "validare_task": "Rulează o operație bulk pe dev store; verifică înregistrare în bulk_runs + job în Redis.",
        "outcome_task": "Orchestrator funcțional cu integrare cozi + persistență.",
        "restrictii_antihalucinatie": "NU lansa bulk fără lock (vezi F5.1.3). NU procesa sincron."
    },
    {
        "id_task": "F5.1.2",
        "denumire_task": "State machine + persistență (bulk_runs/bulk_steps/bulk_artifacts)",
        "descriere_task": "Implementează state machine-ul complet pentru Bulk Operations:\n\n**Tabele (extinde schema din F2.2):**\n```sql\n-- bulk_steps\nCREATE TABLE bulk_steps (\n  id uuid PRIMARY KEY DEFAULT uuidv7(),\n  bulk_run_id uuid REFERENCES bulk_runs(id) ON DELETE CASCADE,\n  shop_id uuid REFERENCES shops(id), -- Denormalizare pt RLS eficient\n  step_name text, -- 'download', 'parse', 'transform', 'copy'\n  status text, -- 'pending', 'running', 'completed', 'failed'\n  started_at timestamptz,\n  completed_at timestamptz,\n  error_message text\n);\n-- Integritate: Asigură consistency shop_id între bulk_runs și bulk_steps (Trigger sau validare app strictă).\nALTER TABLE bulk_steps ENABLE ROW LEVEL SECURITY;\nALTER TABLE bulk_steps FORCE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation_bulk_steps ON bulk_steps FOR ALL TO app_runtime\n  USING (shop_id = COALESCE(current_setting('app.current_shop_id', true)::uuid, '00000000-0000-0000-0000-000000000000'::uuid));\n\n-- bulk_errors\nCREATE TABLE bulk_errors (\n  id uuid PRIMARY KEY DEFAULT uuidv7(),\n  bulk_run_id uuid REFERENCES bulk_runs(id) ON DELETE CASCADE,\n  shop_id uuid REFERENCES shops(id),\n  error_type text,\n  error_message text,\n  payload jsonb, -- linia originală care a eșuat\n  created_at timestamptz DEFAULT now()\n);\n-- Security/GDPR: Payload trebuie minimizat (fără PII, doar chei). Retenție limitată (TTL/Cleanup Job).\nALTER TABLE bulk_errors ENABLE ROW LEVEL SECURITY;\nALTER TABLE bulk_errors FORCE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation_bulk_errors ON bulk_errors FOR ALL TO app_runtime\n  USING (shop_id = COALESCE(current_setting('app.current_shop_id', true)::uuid, '00000000-0000-0000-0000-000000000000'::uuid));\n\n-- bulk_artifacts\nCREATE TABLE bulk_artifacts (\n  id uuid PRIMARY KEY DEFAULT uuidv7(),\n  bulk_run_id uuid REFERENCES bulk_runs(id) ON DELETE CASCADE,\n  shop_id uuid REFERENCES shops(id),\n  artifact_type text, -- 'result' | 'partial' | 'error' | 'checkpoint'\n  url text,\n  bytes_processed bigint DEFAULT 0,\n  rows_processed bigint DEFAULT 0,\n  checksum text,\n  created_at timestamptz DEFAULT now()\n);\nALTER TABLE bulk_artifacts ENABLE ROW LEVEL SECURITY;\nALTER TABLE bulk_artifacts FORCE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation_bulk_artifacts ON bulk_artifacts FOR ALL TO app_runtime\n  USING (shop_id = COALESCE(current_setting('app.current_shop_id', true)::uuid, '00000000-0000-0000-0000-000000000000'::uuid));\n\n-- bulk_runs (extensie)\nALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS\n  operation_type text,\n  shopify_operation_id text,\n  query_type text,\n  idempotency_key text, -- NU UNIQUE global\n  cursor jsonb,\n  error_message text,\n  retry_count int DEFAULT 0;\n\n-- Partial Index pentru Idempotency (permite re-run istoric, blochează concurență activă)\nCREATE UNIQUE INDEX idx_bulk_runs_active_idempotency ON bulk_runs (shop_id, idempotency_key)\nWHERE status IN ('pending', 'running', 'polling', 'downloading', 'processing');\n```\n\n**Path Migrații:** `packages/database/drizzle/migrations` (fără `src`)\n\n**Statusuri:** pending → running → polling → downloading → processing → completed/failed/cancelled\n\n**Idempotency:** `idempotency_key = sha256(shopId + operationType + queryType + payloadHash)`. Indexul parțial previne doar dublu-start pe job-uri active.\n\n**Resume:** La restart, preia runs cu status != completed/failed și continuă de la ultimul checkpoint.",
        "cale_implementare": "/Neanelu_Shopify/packages/database/drizzle/migrations + /apps/backend-worker/src/processors/bulk-operations/state-machine.ts",
        "contextul_anterior": "F2.2 definește bulk_runs; trebuie extins pentru state management complet.",
        "validare_task": "Testează transitions: start → poll → complete. Verifică resume după kill process.",
        "outcome_task": "State machine complet, persistent, restartable.",
        "restrictii_antihalucinatie": "NU stoca stare doar în memorie. NU omite RLS pe tabelele noi."
    },
    {
        "id_task": "F5.1.3",
        "denumire_task": "Enforce \"1 bulk op/shop\" (consum lock distribuit din F4.3.5)",
        "descriere_task": "**OBLIGATORIU:** Consumă lock-ul distribuit definit în F4.3.5 pentru a garanta maxim 1 bulk operation activă per shop.\n\n**Implementare:**\n```typescript\nimport { acquireBulkLock, releaseBulkLock } from '@app/queue-manager/bulk-lock';\n\nasync function processBulkJob(job: Job) {\n  const lockAcquired = await acquireBulkLock(job.data.shopId, {\n    ttl: 30 * 60 * 1000, // 30 min max\n    refreshInterval: 60 * 1000 // refresh TTL periodic\n  });\n  \n  if (!lockAcquired) {\n    // Job rămâne în coadă, reîncercare cu delay explicit (nu eroare)\n    await job.moveToDelayed(Date.now() + 60000); // retry in 1 min\n    return;\n  }\n  \n  try {\n    await executeBulkOperation(job);\n  } finally {\n    await releaseBulkLock(job.data.shopId);\n  }\n}\n```\n\n**Metrics/Events:**\n- `bulk.lock_acquired` / `bulk.lock_released`\n- `bulk.lock_contention` (counter, nu failure)",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/lock-integration.ts",
        "contextul_anterior": "F4.3.5 definește lock-ul; F5 TREBUIE să-l consume.",
        "validare_task": "Lansează 2 bulk ops pentru același shop simultan; doar una rulează, cealaltă așteaptă.",
        "outcome_task": "Zero concurrency conflicts pentru bulk per shop.",
        "restrictii_antihalucinatie": "NU omite lock-ul. NU implementa lock propriu (folosește cel din F4)."
    },
    {
        "id_task": "F5.1.4",
        "denumire_task": "Poller robust Shopify (polling cu backoff, timeout, partialDataUrl)",
        "descriere_task": "Implementează polling-ul pentru Shopify bulk operation status:\n\n**GraphQL Query:**\n```graphql\nquery BulkOperationStatus {\n  currentBulkOperation {\n    id\n    status\n    url\n    partialDataUrl\n    errorCode\n    objectCount\n    fileSize\n  }\n}\n```\n\n**Polling Strategy:**\n- Initial: 5s interval\n- Backoff exponențial: 5s → 10s → 20s → 30s (max)\n- Timeout global: 4h (configurable)\n\n**Handlers:**\n- `COMPLETED`: download URL, continuă pipeline\n- `FAILED`: log error, retry dacă transient, DLQ dacă permanent\n- `RUNNING`: continuă polling\n- `partialDataUrl`: salvează ca artifact separat, procesează partial\n\n**URL Expiration:** URL-urile Shopify expiră în 7 zile; download imediat după COMPLETED.",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/poller.ts",
        "contextul_anterior": "Orchestratorul pornește operația; poller-ul urmărește progresul.",
        "validare_task": "Mock bulk op cu delay; verifică rate de polling. Testează partialDataUrl handling.",
        "outcome_task": "Polling robust, efficient, cu handling complet pentru toate stările.",
        "restrictii_antihalucinatie": "NU poll la rată fixă (ineficient). NU ignora partialDataUrl."
    },
    {
        "id_task": "F5.1.5",
        "denumire_task": "Integrare rate limiting (consum limiter din F4.3)",
        "descriere_task": "Consumă rate limiter-ul din F4.3 pentru toate apelurile Shopify GraphQL din bulk orchestration:\n\n**Apeluri care consumă rate limit:**\n- `bulkOperationRunQuery` / `bulkOperationRunMutation` (start)\n- `currentBulkOperation` (polling)\n- `stagedUploadsCreate` (pentru mutations)\n\n**Integrare:**\n```typescript\nimport { withShopifyRateLimit } from '@app/queue-manager/rate-limiter';\n\nconst result = await withShopifyRateLimit(shopId, async () => {\n  return shopifyClient.query({ ... });\n});\n```\n\n**Backoff (GraphQL):** Calculează delay bazat pe `restoreRate` și `currentlyAvailable` (cost-based throttling), nu header HTTP fix.\n\n**NU \"sleep activ\":** Nu bloca worker-ul; folosește `job.moveToDelayed(timestamp)`.",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/rate-limit-integration.ts",
        "contextul_anterior": "F4.3 definește rate limiter; F5 consumă pentru apeluri Shopify.",
        "validare_task": "Simulează rate limit exceeded; verifică că job-ul e delayed, nu blocat.",
        "outcome_task": "Zero rate limit violations, efficient resource usage.",
        "restrictii_antihalucinatie": "NU implementa rate limiting propriu. NU face sleep() în worker."
    },
    {
        "id_task": "F5.1.6",
        "denumire_task": "Contract \"stitched\" query sets (Core/Meta/Inventory + chei stitching)",
        "descriere_task": "Definește contractul pentru query-urile bulk și strategia de stitching:\n\n**Query Types:**\n1. **Core:** Products + Variants (base data)\n2. **Meta:** Metafields + Metaobjects\n3. **Inventory:** InventoryItems + InventoryLevels\n\n**Stitching Keys:**\n- Product → Variant: `product.id` = `variant.product.id`\n- Product → Metafield: `product.id` = `metafield.owner.id`\n- Variant → InventoryItem: `variant.inventoryItem.id` = `inventoryItem.id`\n\n**Schema Versioning:**\n- Query-urile sunt versionate (ex: `CORE_QUERY_V1`)\n- La schimbare, migrează contractul explicit\n\n**Ordinea execuției:**\n1. Core (părinți)\n2. Meta (extinde părinți)\n3. Inventory (extinde variante)",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/queries/index.ts",
        "contextul_anterior": "Bulk ops returnează JSONL flat; stitching reconstituie relațiile.",
        "validare_task": "Documentație clară pentru fiecare query type + unit test pe stitching keys.",
        "outcome_task": "Contract clar și versionat pentru toate query-urile bulk.",
        "restrictii_antihalucinatie": "NU hardcoda query-uri în processors. NU omite versionarea."
    },
    {
        "id_task": "F5.1.7",
        "denumire_task": "Failure policy enterprise (thresholds, DLQ, partialDataUrl artifact)",
        "descriere_task": "Definește politica de failure handling pentru bulk operations:\n\n**Error Thresholds:**\n- `MAX_RETRY_COUNT = 3` pentru erori tranzitorii\n- `ERROR_RATE_THRESHOLD = 0.1` (10% erori → abort)\n\n**Categorii de erori:**\n- **Transient:** TIMEOUT, RATE_LIMITED, NETWORK → retry cu backoff\n- **Permanent:** INVALID_QUERY, AUTH_FAILED, SHOP_DELETED → DLQ direct\n\n**DLQ Integration:**\n- Folosește `@app/queue-manager` DLQ din F4.1.4\n- Payload: { originalJob, errorType, attempts, lastError }\n\n**partialDataUrl Handling:**\n- Salvat ca artifact separat (nu pierdut)\n- Procesat după retry eșuat\n- Marcat în bulk_runs.cursor pentru resume",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/failure-handler.ts",
        "contextul_anterior": "F4.1.4 definește DLQ; F5 implementează policy specifică bulk.",
        "validare_task": "Simulează erori transient + permanent; verifică retry, DLQ, partialDataUrl saved.",
        "outcome_task": "Failure handling predictibil și recuperabil.",
        "restrictii_antihalucinatie": "NU retry infinit. NU ignora partialDataUrl."
    },
    {
        "id_task": "F5.1.8",
        "denumire_task": "Bulk Mutation – stagedUploadsCreate + chunking JSONL",
        "descriere_task": "Implementează flow-ul complet pentru Shopify Bulk Mutations:\n\n**1. Generare JSONL:**\n- Stream generator pentru input data\n- Format: o linie per mutație\n\n**2. Chunking (CONFORM Docs ~90MB limit):**\n```typescript\nconst CHUNK_SIZE = 90 * 1024 * 1024; // 90MB\n\nasync function* chunkJsonl(input: AsyncIterable<object>) {\n  // ... logica buffer ...\n  const lineBytes = Buffer.byteLength(line, 'utf8');\n  if (size + lineBytes > CHUNK_SIZE) {\n    // yield chunk\n  }\n  // ...\n}\n```\n\n**3. stagedUploadsCreate:**\n// ... snippet ...\n\n**4. Upload JSONL:** POST multipart.\n\n**5. bulkOperationRunMutation:** Folosește `stagedUploadPath` (derivat din target) ca `stagedUploadPath` argument.",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/mutation/staged-upload.ts",
        "contextul_anterior": "Query-urile sunt implementate; mutations au flow diferit.",
        "validare_task": "Upload JSONL de test; verifică stagedUploadsCreate + bulkOperationRunMutation.",
        "outcome_task": "Bulk mutations complete cu chunking corect.",
        "restrictii_antihalucinatie": "NU depăși 90MB per chunk. NU omite parameters din stagedUploadsCreate."
    },
    {
        "id_task": "F5.1.9",
        "denumire_task": "Bulk Mutation – ingestie rezultate + reconciliere",
        "descriere_task": "Procesează rezultatele bulk mutations și reconciliază cu input-ul:\n\n**Parse Results JSONL:**\n- Fiecare linie conține { data: {...}, errors: [...] }\n- Corelează cu input via line number sau custom ID\n\n**Reconciliere:**\n- SUCCESS: marchează input processat\n- ERROR: extrage message + field, adaugă la bulk_errors\n- PARTIAL: requeue doar failed items\n\n**Raport Erori:**\n- Agregă erori per tip (ex: INVALID_VALUE, NOT_FOUND)\n- Salvează în bulk_artifacts cu type='error'\n\n**Selective Requeue:**\n- Doar items cu erori recoverabile\n- Respectă MAX_RETRY_COUNT",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/mutation/result-reconciler.ts",
        "contextul_anterior": "Mutations sunt lansate; trebuie procesate rezultatele.",
        "validare_task": "Bulk mutation cu mix success/error; verifică reconciliere corectă.",
        "outcome_task": "Rezultate mutations procesate și reconciliate complet.",
        "restrictii_antihalucinatie": "NU ignora erori. NU requeue infinit."
    }
    ]
    ```

### F5.2: Pipeline streaming JSONL → transform → COPY (Postgres)

    ```JSON
    [
    {
        "id_task": "F5.2.1",
        "denumire_task": "Pipeline streaming end-to-end (download → parse → transform → COPY)",
        "descriere_task": "Implementează pipeline-ul complet de ingestie streaming:\n\n**Arhitectură:**\n```\nHTTP Download Stream\n  → Decompress (gzip/deflate dacă necesar)\n  → Parse JSONL (stream-json)\n  → Transform/Stitch (parent-child remap)\n  → COPY Writer (pg-copy-streams)\n  → Staging Table\n```\n\n**Backpressure:** Fiecare etapă respectă highWaterMark pentru flow control.\n\n**Memory Target:** Max 200MB heap pentru 1M rows.\n\n**Dependencies:**\n- `stream-json` pentru parsing\n- `pg-copy-streams` pentru COPY\n- Node.js native streams (pipeline)",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/pipeline/index.ts",
        "contextul_anterior": "Bulk URL este disponibil după polling COMPLETED.",
        "validare_task": "Procesează 1GB JSONL; heap stabil sub 300MB.",
        "outcome_task": "Pipeline streaming funcțional, memory-safe.",
        "restrictii_antihalucinatie": "NU încărca fișierul în memorie. NU folosi INSERT per rând."
    },
    {
        "id_task": "F5.2.2",
        "denumire_task": "Downloader hardening (retry, timeout, compression, throttling)",
        "descriere_task": "Hardening pentru HTTP download stream:\n\n**Retry Strategy:**\n- Max 3 retries cu exponential backoff\n- Resume de la byte offset (Range header) -> **Best Effort** (doar dacă Content-Encoding: identity, altfel re-download).\n\n**Timeouts:**\n- Connection timeout: 30s\n- Read timeout: 60s per chunk\n- Total timeout: 4h (configurable)\n\n**Compression:**\n- Detectează Content-Encoding (gzip, deflate)\n- Decompress inline cu zlib.createGunzip()\n\n**Throttling Awareness:**\n- Respectă Retry-After header\n- Emit event pentru rate limiting\n\n**Validare:**\n- Verifică Content-Length dacă prezent\n- Checksum la final dacă disponibil",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/pipeline/stages/download.ts",
        "contextul_anterior": "URL-ul vine de la Shopify; download-ul trebuie să fie robust.",
        "validare_task": "Simulează failed download mid-stream; verifică retry + resume.",
        "outcome_task": "Download robust cu toate edge cases handled.",
        "restrictii_antihalucinatie": "NU presupune download fără erori. NU ignora compression."
    },
    {
        "id_task": "F5.2.3",
        "denumire_task": "Parser JSONL tolerant (invalid lines, counters, schema validation)",
        "descriere_task": "Parser JSONL cu toleranță la erori:\n\n**Invalid Line Handling:**\n- Log warning (fără payload complet)\n- Increment counter `parse.invalid_lines`\n- Continuă procesarea (nu abort)\n\n**Counters:**\n- `parse.total_lines`\n- `parse.valid_lines`\n- `parse.invalid_lines`\n- `parse.bytes_processed`\n\n**Schema Validation (minimal):**\n- Verifică prezența __typename sau id\n- Nu validare completă (performanță)\n\n**Logging:**\n- NU loga payload complet (date sensitive)\n- Log doar: line number, error type, field name",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/pipeline/stages/parse.ts",
        "contextul_anterior": "Shopify JSONL poate avea inconsistențe; trebuie toleranță.",
        "validare_task": "JSONL cu linii invalide; verifică continuare + counters corecte.",
        "outcome_task": "Parser robust care nu se oprește la erori minore.",
        "restrictii_antihalucinatie": "NU abort la prima eroare. NU log payload-uri complete."
    },
    {
        "id_task": "F5.2.4",
        "denumire_task": "Transform \"stitching\" (parent-child remap, JSONB flatten)",
        "descriere_task": "Implementează stitching transform conform Docs/Structura_Proiect:\n\n**Parent-Child Remap:**\n```typescript\n// Shopify JSONL are linii flat; trebuie reconstituire\n// Input: { __typename: 'ProductVariant', product: { id: 'gid://...' } }\n// Output: { variantId, productId (extracted), ... }\n\nclass ParentChildStitcher extends Transform {\n  private parentBuffer = new Map<string, object>();\n  \n  _transform(chunk, encoding, callback) {\n    const type = chunk.__typename;\n    if (isParentType(type)) {\n      this.parentBuffer.set(chunk.id, chunk);\n    }\n    // Emit child cu referință la parent\n    const stitched = this.stitchWithParent(chunk);\n    this.push(stitched);\n    callback();\n  }\n}\n```\n\n**JSONB Flatten:**\n- Metafields → jsonb column\n- Extrage namespace/key pentru indexare\n\n**Row Shapes:**\n- Transform în format compatibil cu COPY (TSV/CSV)",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/pipeline/stages/transformation/stitching/parent-child-remapper.ts",
        "contextul_anterior": "JSONL flat trebuie transformat în relații DB.",
        "validare_task": "JSONL cu Products + Variants; verifică stitching corect.",
        "outcome_task": "Stitching funcțional pentru toate entity types.",
        "restrictii_antihalucinatie": "NU buffer nelimitat (folosește spill-to-disk sau 2-pass pentru orphans). NU pierde parent-child refs."
    },
    {
        "id_task": "F5.2.5",
        "denumire_task": "COPY writer + staging tables (tranzacții, RLS, backpressure)",
        "descriere_task": "Implementează COPY writer cu staging tables:\n\n**Staging Tables:**\n```sql\nCREATE TABLE staging_products (\n  LIKE products INCLUDING DEFAULTS,\n  bulk_run_id uuid,\n  imported_at timestamptz DEFAULT now()\n);\nALTER TABLE staging_products ENABLE ROW LEVEL SECURITY;\n-- Policy identică cu products\n```\n\n**COPY Writer:**\n```typescript\n// Tranzacție explicită per chunk\nawait client.query('BEGIN');\ntry {\n  await client.query(`SET LOCAL app.current_shop_id = $1::uuid`, [shopId]);\n  // ... COPY stream logic ...\n  await client.query('COMMIT');\n} catch (e) {\n  await client.query('ROLLBACK');\n  throw e;\n}\n```",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/pipeline/stages/copy-writer.ts + /packages/database/src/streaming/pg-copy-streams.manager.ts",
        "contextul_anterior": "Transform output trebuie scris în DB rapid și safe.",
        "validare_task": "COPY 100k rows; verifică tranzacție, RLS context, performance.",
        "outcome_task": "COPY robust în staging tables cu RLS enforced.",
        "restrictii_antihalucinatie": "NU omite SET LOCAL pentru RLS. NU COPY direct în tabele finale."
    },
    {
        "id_task": "F5.2.6",
        "denumire_task": "Merge în tabele finale (upsert, tombstones, FK integrity)",
        "descriere_task": "Implementează merge din staging în tabele finale:\n\n**Upsert Strategy:**\n```sql\n-- NU insera ID din staging (conflict posibil la rerun)\n-- Lasă generated default sau manage shopify_id\nINSERT INTO products (shop_id, shopify_id, title, ...)\nSELECT s.shop_id, s.shopify_id, s.title, ...\nFROM staging_products s\nWHERE s.bulk_run_id = $1\nON CONFLICT (shop_id, shopify_id) DO UPDATE ...\n```\n\n**Tombstones/Deletes:**\n- Detectează items în products dar nu în staging (deleted în Shopify)\n- Soft delete: `deleted_at = now()` sau hard delete\n\n**FK Integrity:**\n- Merge parents înainte de children\n- Ordinea: shops → products → variants → inventory\n\n**Replay Safe:**\n- Același bulk_run_id processat de 2x = același rezultat",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/pipeline/stages/merge.ts",
        "contextul_anterior": "Staging tables conțin datele; trebuie merge în finale.",
        "validare_task": "Merge cu upserts + deletes; verifică idempotency.",
        "outcome_task": "Merge corect și idempotent din staging în finale.",
        "restrictii_antihalucinatie": "NU omite FK order. NU ignora deletes."
    },
    {
        "id_task": "F5.2.7",
        "denumire_task": "Checkpointing/resume (byte offset, line number, re-run safe)",
        "descriere_task": "Implementează checkpointing pentru resume după failure:\n\n**Checkpoint Model:**\n```typescript\ninterface Checkpoint {\n  bulkRunId: string;\n  artifactId: string;\n  bytesProcessed: number;\n  linesProcessed: number;\n  lastSuccessfulId: string; // ultimul entity ID procesat\n  updatedAt: Date;\n}\n```\n\n**Persistență:**\n- Salvează checkpoint în bulk_artifacts.bytes_processed/rows_processed\n- Update la fiecare N linii (ex: 10000) sau K bytes (ex: 10MB)\n\n**Resume Logic:**\n1. La start, verifică dacă există checkpoint pentru artifact\n2. Dacă da, skip la byte offset (Range header) sau line number\n3. Continuă procesarea de acolo\n\n**Re-run Safe:**\n- Staging table cleanup: `DELETE FROM staging WHERE bulk_run_id = $id` la START run (nu la resume).\n- Merge final este idempotent (upsert).",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/pipeline/checkpoint.ts",
        "contextul_anterior": "Procesare 1M rows poate dura ore; restart nu trebuie să piardă progresul.",
        "validare_task": "Kill process mid-run; restart și verifică resume fără duplicates.",
        "outcome_task": "Resume funcțional după orice failure.",
        "restrictii_antihalucinatie": "NU restart de la 0 fără checkpoint. NU dubla datele la resume."
    },
    {
        "id_task": "F5.2.8",
        "denumire_task": "Performance & ops knobs (concurrency, batching, VACUUM)",
        "descriere_task": "Configurații pentru performance tuning:\n\n**Concurrency Limits:**\n- `MAX_CONCURRENT_DOWNLOADS = 2` per worker\n- `MAX_CONCURRENT_COPIES = 2` per shop (Aliniat F4.2)\n- `MAX_GLOBAL_INGESTION = 10` (across all shops)\n\n**Batching:**\n- COPY batch size: 10000 rows sau 50MB\n- Commit frequency: per batch (nu per row)\n\n**Index Strategy:**\n- Reindex post-merge pe staging tables (faster scans după bulk)\n- Control: `BULK_STAGING_REINDEX=true`\n\n**VACUUM Plan:**\n```sql\n-- După merge\nANALYZE products;\n-- Periodic (nu la fiecare run)\nVACUUM ANALYZE products;\n```\n\n**Observabilitate:**\n- Metric: `ingestion.rows_per_second`\n- Alert: < 1000 rows/s pentru > 5 min",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/config.ts",
        "contextul_anterior": "Pipeline funcționează; trebuie tuning pentru 1M+ SKU.",
        "validare_task": "Benchmark cu configurații diferite; documentează optimal settings.",
        "outcome_task": "Performance tuning documented și configurable.",
        "restrictii_antihalucinatie": "NU hardcoda valori. NU omite ANALYZE."
    },
    {
        "id_task": "F5.2.9",
        "denumire_task": "Deduplicare semantică la ingestie (vector similarity pe titlu/brand) - redistribuit din F8.3.1",
        "descriere_task": "**MUTAT din F8.3.1 - INTEGRARE la ingestie, nu post-processing**\n\nImplementează deduplicare semantică în pipeline-ul de ingestie bulk utilizând pgvector din F2.2.7:\n\n**Flux Deduplicare:**\n```typescript\nasync function checkDuplicate(product: IngestedProduct): Promise<DedupeResult> {\n  // 1. Primary: GTIN/EAN exact match\n  if (product.barcode) {\n    const existing = await db.query(sql`\n      SELECT id FROM prod_core WHERE internal_sku = ${product.barcode}\n    `);\n    if (existing.rows.length > 0) {\n      return { isDuplicate: true, existingId: existing.rows[0].id, method: 'barcode' };\n    }\n  }\n  \n  // 2. Secondary: Vector similarity (dacă embedding disponibil)\n  const embedding = await generateEmbedding(`${product.title} ${product.vendor}`);\n  const similar = await db.query(sql`\n    SELECT product_id, 1 - (embedding <=> ${embedding}) as similarity\n    FROM prod_embeddings\n    WHERE embedding_type = 'title_brand'\n      AND 1 - (embedding <=> ${embedding}) >= ${DEDUPE_SIMILARITY_THRESHOLD}\n    ORDER BY embedding <=> ${embedding}\n    LIMIT 1\n  `);\n  \n  if (similar.rows.length > 0 && similar.rows[0].similarity >= 0.95) {\n    return { isDuplicate: true, existingId: similar.rows[0].product_id, method: 'vector', similarity: similar.rows[0].similarity };\n  }\n  \n  // 3. Suspicious zone: 0.85-0.95 similarity\n  if (similar.rows.length > 0 && similar.rows[0].similarity >= 0.85) {\n    return { isDuplicate: false, suspicious: true, candidateId: similar.rows[0].product_id, similarity: similar.rows[0].similarity };\n  }\n  \n  return { isDuplicate: false, suspicious: false };\n}\n```\n\n**Batch Embedding (pentru eficiență):**\n```typescript\n// Procesare în batch-uri de 100 pentru eficiență cost OpenAI\nconst EMBEDDING_BATCH_SIZE = 100;\n\nasync function batchGenerateEmbeddings(products: IngestedProduct[]): Promise<Map<string, number[]>> {\n  const inputs = products.map(p => `${p.title} ${p.vendor}`);\n  const response = await openai.embeddings.create({\n    model: 'text-embedding-3-small',\n    input: inputs,\n  });\n  return new Map(products.map((p, i) => [p.id, response.data[i].embedding]));\n}\n```\n\n**Thresholds configurabile:**\n- `DEDUPE_SIMILARITY_THRESHOLD = 0.95` (foarte similar = merge automat)\n- `DEDUPE_SUSPICIOUS_THRESHOLD = 0.85` (similar = flag pentru review)\n- `EMBEDDING_MODEL = 'text-embedding-3-small'`\n\n**Acțiuni post-dedupe:**\n- isDuplicate=true → link la prod_core existent, actualizează metadata\n- suspicious=true → creează prod_core nou cu dedupe_status='suspicious'\n- isDuplicate=false → creează prod_core nou cu dedupe_status='unique'",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/deduplication.ts",
        "contextul_anterior": "F2.2.7 a creat schema pgvector. F5.2 procesează JSONL și face COPY. Deduplicarea trebuie să ruleze ÎNAINTE de insert în prod_core.",
        "validare_task": "Ingestează 2 produse cu titluri aproape identice ('iPhone 15 Pro 256GB' și 'iPhone 15 Pro 256 GB'). Verifică că al doilea e linkat la primul, nu duplicat.",
        "outcome_task": "Zero duplicate la ingestie pentru produse semantic similare.",
        "restrictii_antihalucinatie": "NU genera embedding per produs individual în loop (prea lent și scump). NU setează threshold sub 0.85 (prea multe false positives). NU sări deduplicarea pentru 'performanță' - e critică pentru PIM."
    },
    {
        "id_task": "F5.2.10",
        "denumire_task": "Consensus/Arbitration pentru date multi-sursă (prioritizare + Golden Record) - redistribuit din F8.3.2",
        "descriere_task": "**MUTAT din F8.3.2 - RULEAZĂ la ingestie, nu post-processing**\n\nImplementează logica de arbitraj când există date din mai multe surse pentru același produs:\n\n**Model Sursă:**\n```typescript\ninterface SourcedValue {\n  value: any;\n  source: 'brand' | 'curated' | 'ai_extracted' | 'bulk_import' | 'webhook';\n  confidence: number; // 0-1\n  timestamp: Date;\n  sourceUrl?: string;\n}\n\nconst SOURCE_PRIORITY: Record<string, number> = {\n  'brand': 100,      // Sursa oficială (API brand, website brand)\n  'curated': 80,     // Date verificate manual\n  'ai_extracted': 50, // Extras cu AI din descrieri\n  'bulk_import': 40,  // Import Shopify bulk\n  'webhook': 30,      // Update incremental webhook\n};\n```\n\n**Logica de Rezolvare:**\n```typescript\nfunction resolveConflict(field: string, values: SourcedValue[]): ResolvedValue {\n  // Sort by: priority DESC, confidence DESC, timestamp DESC (newest)\n  const sorted = values.sort((a, b) => \n    (SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source]) ||\n    (b.confidence - a.confidence) ||\n    (b.timestamp.getTime() - a.timestamp.getTime())\n  );\n  \n  const winner = sorted[0];\n  const alternates = sorted.slice(1);\n  \n  // Flag pentru review dacă există divergență semnificativă\n  const needsReview = alternates.some(alt => \n    alt.confidence > 0.7 && \n    JSON.stringify(alt.value) !== JSON.stringify(winner.value)\n  );\n  \n  return {\n    value: winner.value,\n    provenance: {\n      source: winner.source,\n      confidence: winner.confidence,\n      resolvedAt: new Date(),\n      alternates: alternates.map(v => ({\n        value: v.value,\n        source: v.source,\n        confidence: v.confidence\n      }))\n    },\n    needsReview\n  };\n}\n```\n\n**Integrare în Pipeline:**\n1. La fiecare ingestie, verifică dacă prod_core există\n2. Dacă există, compară fiecare câmp cu valorile existente\n3. Aplică arbitraj pentru câmpurile în conflict\n4. Salvează provenance în prod_specs_normalized.provenance\n5. Setează needs_review=true dacă există divergențe\n\n**Persistență Provenance:**\n```sql\n-- Exemplu prod_specs_normalized.provenance\n{\n  \"title\": {\n    \"source\": \"brand\",\n    \"confidence\": 0.99,\n    \"resolvedAt\": \"2024-01-15T10:30:00Z\",\n    \"alternates\": [\n      { \"value\": \"iPhone 15 Pro\", \"source\": \"bulk_import\", \"confidence\": 0.8 }\n    ]\n  },\n  \"price\": {\n    \"source\": \"webhook\",\n    \"confidence\": 1.0,\n    \"resolvedAt\": \"2024-01-15T14:00:00Z\"\n  }\n}\n```",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/consensus.ts",
        "contextul_anterior": "F5.2.9 a identificat duplicatele. Acum rezolvăm conflictele între date din surse diferite pentru același produs.",
        "validare_task": "Ingestează 2 feed-uri cu același produs dar prețuri diferite (brand=100€, bulk_import=99€). Verifică că Golden Record are preț=100€ (sursa brand) și provenance conține ambele valori.",
        "outcome_task": "Golden Record de înaltă încredere cu provenance auditabil pentru fiecare câmp.",
        "restrictii_antihalucinatie": "NU alege random când există conflict - respectă ordinea de prioritate. NU pierde datele alternative - păstrează în provenance. NU ignora timestamp - ultima actualizare contează la egalitate."
    },
    {
        "id_task": "F5.2.11",
        "denumire_task": "Implementare __parentId stitching în streaming pipeline (CONFORM AUDIT 2025-12-26)",
        "descriere_task": "**CONFORM ADDENDUM B:** Implementează logica de reconstituire relații parent-child în streaming mode:\n\n**Problema:**\n- JSONL din Bulk Export conține linii separate pentru Product și ProductVariant\n- Relația se face prin `__parentId` (variant → product)\n- Liniile NU sunt neapărat grupate perfect\n- NU putem ține totul în RAM pentru 1M+ SKU\n\n**Implementare Streaming:**\n```typescript\n// apps/backend-worker/src/processors/bulk-operations/pipeline/stages/transformation/stitching/parent-child-remapper.ts\n\ninterface LineBuffer {\n  products: Map<string, Product>; // keyed by id\n  orphanVariants: Map<string, ProductVariant[]>; // keyed by __parentId\n}\n\nclass ParentChildRemapper {\n  private buffer: LineBuffer = { products: new Map(), orphanVariants: new Map() };\n  private readonly FLUSH_THRESHOLD = 10000; // flush after N products processed\n  \n  async processLine(line: BulkLine): Promise<void> {\n    if (line.__typename === 'Product') {\n      this.buffer.products.set(line.id, line);\n      // Check for orphan variants waiting for this parent\n      const orphans = this.buffer.orphanVariants.get(line.id);\n      if (orphans) {\n        await this.emitProduct(line, orphans);\n        this.buffer.orphanVariants.delete(line.id);\n        this.buffer.products.delete(line.id);\n      }\n    } else if (line.__typename === 'ProductVariant') {\n      const parentId = line.__parentId;\n      const parent = this.buffer.products.get(parentId);\n      if (parent) {\n        // Parent already seen - emit directly\n        await this.emitVariant(parent, line);\n      } else {\n        // Parent not yet seen - buffer variant\n        const existing = this.buffer.orphanVariants.get(parentId) || [];\n        existing.push(line);\n        this.buffer.orphanVariants.set(parentId, existing);\n      }\n    }\n    \n    // Periodic flush for memory control\n    if (this.buffer.products.size > this.FLUSH_THRESHOLD) {\n      await this.flushCompleteProducts();\n    }\n  }\n  \n  async finish(): Promise<void> {\n    // Emit remaining products (some may have no variants)\n    for (const [id, product] of this.buffer.products) {\n      const variants = this.buffer.orphanVariants.get(id) || [];\n      await this.emitProduct(product, variants);\n    }\n    // Log orphan variants (parent never found - data issue)\n    for (const [parentId, variants] of this.buffer.orphanVariants) {\n      if (!this.buffer.products.has(parentId)) {\n        logger.warn('Orphan variants found', { parentId, count: variants.length });\n        await this.quarantineOrphans(parentId, variants);\n      }\n    }\n  }\n}\n```\n\n**Integrare în Pipeline:**\n- Stage: între `bulk.download` și `bulk.copy`\n- Input: raw JSONL lines stream\n- Output: enriched lines cu `product` pentru fiecare variant\n\n**Edge Cases:**\n- Orphan variants (parent nu există) → quarantine + log\n- Products fără variants → emit as-is\n- Memory pressure → incremental flush",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/pipeline/stages/transformation/stitching/parent-child-remapper.ts",
        "contextul_anterior": "Addendum B definește problema. F5.2.8-F5.2.10 pregătesc datele. Stitching e critic pentru relații corecte.",
        "validare_task": "1. JSONL cu 10K products + variants → toate variants au parent valid\n2. Memory usage stable (nu crește liniar cu file size)\n3. Orphan variants logged și quarantined",
        "outcome_task": "Relații parent-child corecte în streaming mode, fără încărcare completă în RAM.",
        "restrictii_antihalucinatie": "NU încărca tot JSONL în RAM. NU presupune ordine perfectă a liniilor. NU ignora orphan variants - log și quarantine."
    }
    ]
    ```

### F5.3: Observabilitate ingestie & bulk

    ```JSON
    [
    {
        "id_task": "F5.3.1",
        "denumire_task": "OTel spans + metrics complete (full lifecycle)",
        "descriere_task": "Implementează observabilitate completă pentru bulk pipeline:\n\n**Spans (trace hierarchy):**\n```\nbulk.orchestration (root)\n├── bulk.start\n├── bulk.poll (repeated)\n├── bulk.download\n│   └── bulk.download.chunk (repeated)\n├── bulk.parse\n├── bulk.transform\n├── bulk.copy\n│   └── bulk.copy.batch (repeated)\n└── bulk.merge\n```\n\n**Metrics:**\n- `bulk.duration_seconds` (histogram, labels: operation_type, status)\n- `bulk.bytes_processed_total` (counter)\n- `bulk.rows_processed_total` (counter)\n- `bulk.errors_total` (counter, labels: error_type)\n- `bulk.active_operations` (gauge, labels: operation_type)\n- `bulk.backlog_bytes` (gauge)\n\n**IMPORTANT:** Nu labels cu cardinalitate mare (ex: shop_domain).\nFolosește shop_id DOAR în span attributes, nu în metric labels.",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/otel/spans.ts + metrics.ts",
        "contextul_anterior": "F4.4 definește convenții OTel; F5 le extinde pentru bulk.",
        "validare_task": "Rulează bulk complet; verifică trace în Jaeger + metrics în dashboard.",
        "outcome_task": "Vizibilitate completă pentru debugging și ops.",
        "restrictii_antihalucinatie": "NU adăuga shop_domain în metric labels. NU log payload-uri."
    },
    {
        "id_task": "F5.3.2",
        "denumire_task": "Semnale operaționale (events, structured logs, DLQ signals)",
        "descriere_task": "Adaugă semnale pentru operațiuni critice:\n\n**Events (OTel Events):**\n- `bulk.started` - { shopId, operationType }\n- `bulk.completed` - { shopId, rowsProcessed, duration }\n- `bulk.failed` - { shopId, errorType, retryable }\n- `bulk.download_retry` - { shopId, attempt, reason }\n- `bulk.copy_aborted` - { shopId, reason, rowsCommitted }\n- `bulk.rows_quarantined` - { shopId, count, sampleIds }\n- `bulk.lock_contention` - { shopId, waitDuration }\n\n**Structured Logs:**\n- Corelate cu traceId + jobId\n- Format: JSON cu câmpuri standard\n- Level: INFO pentru success, WARN pentru retries, ERROR pentru failures\n\n**DLQ Signals:**\n- Emit event când job intră în DLQ\n- Dashboard/alert pentru DLQ growth",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/otel/events.ts + logger.ts",
        "contextul_anterior": "Spans și metrics există; events completează observabilitatea.",
        "validare_task": "Simulează failure scenarios; verifică events emitted corect.",
        "outcome_task": "Semnale complete pentru toate stările operaționale.",
        "restrictii_antihalucinatie": "NU log date sensitive. NU omite correlation IDs."
    }
    ]
    ```

### F5.4: Testing & hardening (CI-friendly, fără dependență de Shopify real)

    ```JSON
    [
    {
        "id_task": "F5.4.1",
        "denumire_task": "Unit tests (node:test) - state machine, lock, retry, chunking",
        "descriere_task": "Unit tests pentru logica internă:\n\n**State Machine Tests:**\n- Transitions valide: PENDING → RUNNING → COMPLETED\n- Transitions invalide respinse\n- Resume de la toate stările intermediare\n\n**Lock Tests:**\n- acquireLock success/failure\n- TTL refresh funcționează\n- Stale lock recovery\n\n**Retry/Backoff Tests:**\n- Backoff exponențial corect\n- Max retries respected\n- Categorii erori (transient vs permanent)\n\n**Chunking Tests:**\n- Chunks sub 90MB\n- Edge cases: empty, single line, exact limit\n\n**Runner:** `node --test` (conform standard proiect)",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/__tests__/unit/",
        "contextul_anterior": "Logica internă trebuie testată izolat de Shopify.",
        "validare_task": "Toate unit tests pass în CI.",
        "outcome_task": "Logică internă acoperită de unit tests.",
        "restrictii_antihalucinatie": "NU folosi Jest. Folosește node:test."
    },
    {
        "id_task": "F5.4.2",
        "denumire_task": "Integration tests pipeline (JSONL fixtures, Postgres container)",
        "descriere_task": "Integration tests pentru pipeline complet:\n\n**Fixtures:**\n- JSONL files cu Products/Variants/Metafields\n- Dimensiuni: small (100 rows), medium (10k), large (100k)\n- Edge cases: linii invalide, caractere speciale, nested objects\n\n**Test Setup:**\n- Postgres container ephemeral (din docker-compose.test.yml sau CI service)\n- Redis container ephemeral\n- Mock HTTP server pentru download\n\n**Assertions:**\n- Row counts în DB match fixture\n- Stitching corect (parent-child refs valid)\n- Idempotency: run 2x = same result\n- RLS enforced (query fără context = 0 rows)",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/__tests__/integration/",
        "contextul_anterior": "Unit tests acoperă logică; integration tests acoperă flow complet.",
        "validare_task": "Integration tests pass local și în CI cu containers.",
        "outcome_task": "Pipeline testat end-to-end fără Shopify real.",
        "restrictii_antihalucinatie": "NU depinde de Shopify API în tests. NU skip RLS tests."
    },
    {
        "id_task": "F5.4.3",
        "denumire_task": "Failure injection tests (truncated downloads, restart, duplicates)",
        "descriere_task": "Tests pentru failure scenarios:\n\n**Truncated Download:**\n- Mock server care închide conexiunea mid-stream\n- Verifică retry + resume de la checkpoint\n\n**partialDataUrl Present:**\n- Mock response cu partialDataUrl\n- Verifică salvare artifact + procesare corectă\n\n**Restart Mid-Run:**\n- Kill process după N rows\n- Restart și verifică:\n  - Resume de la checkpoint\n  - Zero duplicate rows\n  - Bulk run ajunge COMPLETED\n\n**Concurrent Bulk Attempt:**\n- 2 workers încearcă bulk pentru același shop\n- Doar unul reușește (lock)\n- Al doilea așteaptă (delay/backoff verificat via metrics/logs)",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/__tests__/chaos/",
        "contextul_anterior": "Happy path e testat; failure paths sunt critice pentru prod.",
        "validare_task": "Toate chaos tests pass; zero data corruption.",
        "outcome_task": "Resilience validată pentru toate failure modes.",
        "restrictii_antihalucinatie": "NU skip restart tests. NU accepta duplicate rows."
    },
    {
        "id_task": "F5.4.4",
        "denumire_task": "Load/soak harness (throughput, memory stability, regression guard)",
        "descriere_task": "Performance testing harness:\n\n**Load Test:**\n- Fixture: 1M rows JSONL\n- Măsoară: rows/second, memory peak, CPU usage\n- Target: > 5000 rows/s, < 500MB heap\n\n**Soak Test:**\n- Rulează 10 bulk operations consecutive\n- Verifică: memory stabilă (no leaks), no connection leaks\n\n**Regression Guard:**\n- Benchmark salvat ca baseline\n- CI fail dacă regress > 20%\n\n**Tools:**\n- Node.js --expose-gc pentru memory analysis\n- Clinic.js sau 0x pentru profiling\n\n**Output:**\n- Raport JSON cu metrics\n- Fail CI dacă sub thresholds",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/__tests__/performance/",
        "contextul_anterior": "Functional tests pass; performance trebuie validată pentru 1M+ scale.",
        "validare_task": "Load test pass cu targets; no memory leaks în soak.",
        "outcome_task": "Performance validată și regression-guarded.",
        "restrictii_antihalucinatie": "NU skip memory tests. NU ignora regressions."
    }
    ]
    ```

### F5.5: Interfață Control Ingestie

    ```JSON
    [
    {
        "id_task": "F5.5.1",
        "denumire_task": "Ingestion UI: Empty State & Trigger",
        "descriere_task": "Hero Section pentru starea Idle: Titlu, Descriere ultima rulare, Buton 'Start Full Sync' (Primary, Blue). Dropzone pentru upload JSONL manual (Secondary area).",
        "cale_implementare": "/apps/web-admin/app/routes/app.ingestion.tsx",
        "contextul_anterior": "Pipeline F5 gata.",
        "validare_task": "Butonul Start declanșează API-ul.",
        "outcome_task": "Control manual ingestie.",
        "restrictii_antihalucinatie": "Design clar pentru starea Idle."
    },
    {
        "id_task": "F5.5.2",
        "denumire_task": "Ingestion UI: Active State Progress & Stepper",
        "descriere_task": "Starea Active: Ascunde Hero, arată Status Card. Stepper orizontal cu 4 pași (Download, Parse, Transform, Save) folosind icon-uri (Check/Spin/Wait). Progress Bar mare animat. Buton 'Abort' (Destructive).",
        "cale_implementare": "/apps/web-admin/app/components/domain/ingestion-progress.tsx",
        "contextul_anterior": "Trigger gata.",
        "validare_task": "UI-ul se schimbă în Active când jobul pornește.",
        "outcome_task": "Feedback vizual procesare.",
        "restrictii_antihalucinatie": "Animație pulse pe active step."
    },
    {
        "id_task": "F5.5.3",
        "denumire_task": "Ingestion UI: Log Console Component",
        "descriere_task": "Componenta `LogConsole`: zonă neagră scrollable. Randează stream de loguri. Feature: Toggle 'Show Errors Only'. Formatare culori: [ERROR] roșu, [WARN] galben.",
        "cale_implementare": "/apps/web-admin/app/components/domain/log-console.tsx",
        "contextul_anterior": "Progress UI gata.",
        "validare_task": "Logurile apar colorate corect.",
        "outcome_task": "Debug vizual.",
        "restrictii_antihalucinatie": "Font monospace obligatoriu."
    },
    {
        "id_task": "F5.5.4",
        "denumire_task": "Ingestion: WebSocket stream pentru live log output",
        "descriere_task": "Conectare la /api/ingestion/:id/logs/ws folosind WebSocket. Append logs în LogConsole în timp real. Auto-scroll to bottom cu detecție user scroll (pause auto-scroll când utilizatorul scrollează manual). Buton Pause/Resume pentru stream. Reconnect automat la disconnect.",
        "cale_implementare": "/apps/web-admin/app/hooks/use-log-stream.ts + /apps/web-admin/app/components/domain/log-console.tsx",
        "contextul_anterior": "LogConsole component gata (F5.5.3). Backend WebSocket endpoint presupus gata.",
        "validare_task": "Logurile apar în timp real fără page refresh. Auto-scroll funcționează. Pause/Resume funcțional.",
        "outcome_task": "Experiență live pentru monitorizare ingestie.",
        "restrictii_antihalucinatie": "Nu folosiți polling - WebSocket obligatoriu. Gestionați cleanup la unmount."
    },
    {
        "id_task": "F5.5.5",
        "denumire_task": "Ingestion: Retry/Resume UI pentru failed ingestions",
        "descriere_task": "Pagină istoric ingestions cu status (Success/Failed/Partial). Pentru failed: buton 'Retry' care repornește de la ultimul checkpoint (dacă backend suportă). Resume cu progress bar care arată unde s-a oprit. Confirmare dialog înainte de retry.",
        "cale_implementare": "/apps/web-admin/app/routes/app.ingestion.history.tsx + /apps/web-admin/app/components/domain/retry-dialog.tsx",
        "contextul_anterior": "Ingestion flow complet (F5.5.1-4).",
        "validare_task": "Retry pornește job nou cu referință la cel vechi. Progress bar arată starea corectă.",
        "outcome_task": "Recuperare din erori fără restart complet.",
        "restrictii_antihalucinatie": "Validați cu backend-ul că retry/resume este suportat înainte de afișare buton."
    },
    {
        "id_task": "F5.5.6",
        "denumire_task": "Ingestion: History Table (toate rulările anterioare)",
        "descriere_task": "Tabel cu: data start, durată, rows procesate, status (badge colorat), errors count. Filtrare per status (dropdown). Sortare per coloană. Link către logs (navighează la LogConsole cu job_id). Paginare server-side.",
        "cale_implementare": "/apps/web-admin/app/routes/app.ingestion.history.tsx + /apps/web-admin/app/components/domain/ingestion-history-table.tsx",
        "contextul_anterior": "Retry UI gata (F5.5.5).",
        "validare_task": "Tabelul afișează date reale din API. Filtrele funcționează. Link-urile navighează corect.",
        "outcome_task": "Vizibilitate completă asupra istoricului.",
        "restrictii_antihalucinatie": "Paginare obligatorie - nu încărcați toate înregistrările odată."
    },
    {
        "id_task": "F5.5.7",
        "denumire_task": "Ingestion: Error Details Expandable (click pentru stack trace)",
        "descriere_task": "În tabelul de erori, rând expandabil (accordion) care arată: error message complet, payload/row care a eșuat, stack trace (dacă disponibil), suggested fix (dacă backend oferă). Copy to clipboard pentru debugging.",
        "cale_implementare": "/apps/web-admin/app/components/domain/error-details-row.tsx",
        "contextul_anterior": "History Table gata (F5.5.6).",
        "validare_task": "Click pe rând expandează detalii. Copy funcționează. Formatare clară pentru stack trace.",
        "outcome_task": "Debugging eficient fără acces la logs server.",
        "restrictii_antihalucinatie": "Nu afișați informații sensibile în suggested fix. Sanitizați payload-ul."
    },
    {
        "id_task": "F5.5.8",
        "denumire_task": "Ingestion: Scheduling UI (programare sync recurent)",
        "descriere_task": "Form pentru cron schedule: preseturi (Daily at, Weekly on, Custom cron). Preview next 5 runs calculate din cron expression. Enable/Disable toggle pentru schedule activ. Validare cron expression client-side. Timezone selector.",
        "cale_implementare": "/apps/web-admin/app/routes/app.ingestion.schedule.tsx + /apps/web-admin/app/components/domain/schedule-form.tsx",
        "contextul_anterior": "Ingestion UI complet (F5.5.1-7).",
        "validare_task": "Schedule se salvează în backend. Preview arată date corecte. Toggle dezactivează fără ștergere.",
        "outcome_task": "Automatizare sync fără intervenție manuală.",
        "restrictii_antihalucinatie": "Validați că backend suportă scheduling. Nu permiteți intervale prea frecvente (min 1h)."
    }
    ]
    ```

    ```JSON
    {
        "id_task": "F5.5.9",
        "denumire_task": "LogConsole component cu transport WebSocket și trace correlation",
        "descriere_task": "**CONFORM Problems & Fixes.md - Gap 2.4:** Extinde LogConsole:\n\n**Props Interface:**\n```typescript\ninterface LogConsoleProps {\n  transport: 'sse' | 'websocket' | 'polling';\n  endpoint: string; // /api/logs/ws\n  shopId?: string;\n  levels?: ('debug' | 'info' | 'warn' | 'error')[];\n  onTraceClick?: (traceId: string) => void;\n  jaegerBaseUrl?: string;\n  maxEventsPerSecond?: number; // default: 50\n  bufferSize?: number; // default: 1000\n}\n```\n\n**Backend endpoint:**\n```typescript\n// GET /api/logs/ws?shopId={uuid}&levels=warn,error\nfastify.get('/api/logs/ws', { websocket: true }, (connection, request) => {\n  // Stream logs via WebSocket with filtering\n});\n```",
        "cale_implementare": "/apps/web-admin/app/components/domain/LogConsole.tsx + /apps/backend-worker/src/routes/logs.ts",
        "contextul_anterior": "F5.5.3 menționează LogStream dar fără specificații transport.",
        "validare_task": "1. WebSocket connection funcționează\n2. Filtrare pe levels\n3. Click pe traceId deschide Jaeger",
        "outcome_task": "Frontend poate afișa loguri în timp real cu trace correlation.",
        "restrictii_antihalucinatie": "Filtrare OBLIGATORIE pe shopId. Rate limiting max 50 events/sec."
    }
    ```

## Faza F6: Integrare AI & Vector Search (Săptămâna 8)

Durată: Săptămâna 8
Obiectiv: embeddings OpenAI Batch + index vectorial în Redis 8.4 + observabilitate completă.

### F6.1: Embeddings (OpenAI Batch) + persistare (Postgres = source of truth / cold storage)

    ```JSON
    [
    {
        "id_task": "F6.1.1",
        "denumire_task": "Schema DB pentru embeddings + batch-runs (RLS, idempotency)",
        "descriere_task": "Auditeaza implementarea curenta. auditeaza efectiv DB in postgres cu comenzi terminal si compara cu migrarile existente. Daca este cazul, adaugă tabele/migrații: product_embeddings (shop_id, product_id, model, dims, content_hash, embedding, generated_at, status, error), ai_batches (shop_id, provider_batch_id, status, created_at, completed_at, request_count, error_count), ai_batch_items (shop_id, batch_id, entity_id, content_hash, status, error). RLS obligatoriu pe shop_id, cu disciplina SET LOCAL din F2/F3.",
        "cale_implementare": "packages/database/",
        "contextul_anterior": "F2 a stabilit Drizzle+migrații SQL + RLS. F5 a populat products.",
        "validare_task": "Migrațiile rulează; RLS returnează 0 rânduri fără context; idempotency pe (shop_id, product_id, content_hash, model).",
        "outcome_task": "Persistență robustă pentru embeddings și execuții Batch, multi-tenant safe.",
        "restrictii_antihalucinatie": "Nu stoca embeddings doar în Redis; Postgres rămâne sursa de adevăr. Nu ocoli RLS."
    },
    {
        "id_task": "F6.1.2",
        "denumire_task": "Content builder + canonicalizare + content_hash (deterministic)",
        "descriere_task": "Definește exact ce intră în embedding (ex: title + body_html curățat + vendor + product_type + tags + metafields selectate). Canonicalizează (trim, lowercase unde e cazul, normalizare whitespace), elimină PII/sensibil, apoi calculează content_hash stabil (ex: sha256).",
        "cale_implementare": "packages/ai-engine/src/",
        "contextul_anterior": "F5 a ingerat date (inclusiv JSONB/metafields).",
        "validare_task": "Același input produce același hash; schimbări minore produc hash nou; nu includem câmpuri sensibile.",
        "outcome_task": "Detecție corectă a produselor noi/modificate pentru embeddings.",
        "restrictii_antihalucinatie": "Nu embed-ui date care nu sunt necesare (minimizare date)."
    },
    {
        "id_task": "F6.1.3",
        "denumire_task": "Selector incremental (pending embeddings) + fairness multi-tenant",
        "descriere_task": "Query incremental: selectează produse unde content_hash curent != ultimul content_hash embed-uit (per model) sau lipsă embedding. Enqueue în BullMQ Pro cu groupId=shop_id și limite per shop (aliniat F4.2).",
        "cale_implementare": "apps/backend-worker/src/processors/ + packages/queue-manager/",
        "contextul_anterior": "F4 are fairness Groups; F5 are merge/idempotency.",
        "validare_task": "Pentru 2 shop-uri, job-urile se intercalează round-robin; niciun shop nu monopolizează worker-ul.",
        "outcome_task": "Backlog embeddings gestionat corect multi-tenant.",
        "restrictii_antihalucinatie": "Nu folosi shop_domain ca identity; doar shop_id."
    },
    {
        "id_task": "F6.1.4",
        "denumire_task": "Orchestrare OpenAI Batch: upload file + create batch + retention policy",
        "descriere_task": "Implementează flow complet: 1. Upload JSONL (file_id), 2. Create Batch (folosind file_id), 3. Persist metadata. Include politica de retenție: șterge fișierele vechi de pe OpenAI după X zile (via cleanup job).",
        "cale_implementare": "packages/ai-engine/src/openai/batch-manager.ts",
        "contextul_anterior": "F0 definește OPENAI_API_KEY (secret). F4 oferă cozi/worker.",
        "validare_task": "În test cu provider mock: JSONL valid, file uploadat, batch creat, job de cleanup șterge fișiere vechi.",
        "outcome_task": "Batch submission complet, auditat și idempotent.",
        "restrictii_antihalucinatie": "Nu loga payload complet; nu scrie secrete în repo."
    },
    {
        "id_task": "F6.1.5",
        "denumire_task": "Poll status + download results + parse + upsert embeddings (RLS enforced)",
        "descriere_task": "Worker care verifică status batch, descarcă rezultatele, parsează, marchează item-urile (SUCCEEDED/FAILED), și face upsert în product_embeddings (tranzacții + SET LOCAL app.current_shop_id).",
        "cale_implementare": "apps/backend-worker/src/processors/ai/ + packages/database/",
        "contextul_anterior": "Disciplina RLS din F2/F3 trebuie respectată la fiecare checkout din pool.",
        "validare_task": "Batch complet -> embeddings persistate; fără context RLS nu vede nimic; rerun nu dublează rânduri.",
        "outcome_task": "Embeddings ajung în Postgres corect și reproducibil.",
        "restrictii_antihalucinatie": "Nu face INSERT-uri fără idempotency key (content_hash + model)."
    },
    {
        "id_task": "F6.1.6",
        "denumire_task": "Retry granular pentru eșecuri (partial failures) + DLQ policy",
        "descriere_task": "Dacă unele item-uri eșuează: requeue doar acele item-uri (nu tot batch-ul). Definește max retries, clasificare erori (transient vs permanent), DLQ și semnale OTel (aliniat stilului din F4/F5).",
        "cale_implementare": "apps/backend-worker/src/processors/ai/",
        "contextul_anterior": "F4.4 definește observabilitate cozi; aplicăm aceeași disciplină aici.",
        "validare_task": "Simulează erori: doar failed items se reprocesează; DLQ crește corect; alerte pot fi puse în F7.",
        "outcome_task": "Reziliență enterprise pentru pipeline-ul AI.",
        "restrictii_antihalucinatie": "Nu reîncerca infinit; nu ascunde erorile (trebuie status în DB)."
    },
    {
        "id_task": "F6.1.7",
        "denumire_task": "Backfill inițial (1M produse) + throttling/cost guardrails",
        "descriere_task": "Job controlat pentru backfill complet după ingestie: chunking, limită per shop și global, ferestre de execuție (nightly), budget caps (items/day). Include kill switch (env flag) pentru oprire rapidă.",
        "cale_implementare": "apps/backend-worker/src/processors/ai/",
        "contextul_anterior": "F5 poate produce milioane de rânduri; F4 fairness trebuie să prevină noisy-neighbor.",
        "validare_task": "Rulează cu fixture mare: nu depășește limitele configurate; poate fi oprit/reluat fără corupție.",
        "outcome_task": "Backfill sigur și operabil la scară.",
        "restrictii_antihalucinatie": "Nu lansa backfill fără throttling și fără mecanism de resume."
    }
    ]
    ```

### F6.2: pgvector Tuning & Operational Hardening (No Redis Vectors)

> [!IMPORTANT]
> **Decizie Arhitecturală Finală (2025):** Utilizăm exclusiv `pgvector` pentru vector search. Redis este folosit DOAR pentru Rate Limiting și Exact Cache (cache la nivel de query result), nu pentru stocare vectori.

    ```JSON
    [
    {
        "id_task": "F6.2.1",
        "denumire_task": "pgvector HNSW Tuning & Maintenance Strategy",
        "descriere_task": "Configurează parametrii optimi pentru indexul HNSW în funcție de volumul de date (1M+ vectors). Definește strategia de mentenanță.\n\n**Tuning (pentru recall > 98% și latency < 10ms):**\n- `m` (max connections): 24-32 (mai mare = search mai rapid, build mai lent/size mai mare)\n- `ef_construction`: 128-256 (calitate index)\n- `ef_search` (runtime): setat dinamic per query (ex: 40-100)\n\n**Maintenance:**\n- Indexul HNSW în pgvector nu necesită `REINDEX` frecvent ca IVFFlat, dar necesită `VACUUM`.\n- Planifică `VACUUM ANALYZE prod_embeddings` săptămânal.\n\n**Resource Guardrails:**\n- `maintenance_work_mem`: creștere temporară în timpul build-ului indexului.\n- `max_parallel_maintenance_workers`: ajustat pentru build rapid.",
        "cale_implementare": "packages/database/src/tuning/pgvector.ts",
        "contextul_anterior": "Schema vectorilor creată în F2.2.7. Acum optimizăm pentru query performance.",
        "validare_task": "Benchmark 100 concurrent queries cu ef_search=40 → latency p95 < 50ms.",
        "outcome_task": "Index performant și stabil pentru production load.",
        "restrictii_antihalucinatie": "NU rula REINDEX blocking în producție. Folosește CONCURRENTLY."
    },
    {
        "id_task": "F6.2.2",
        "denumire_task": "API Vector Search Implementation (pgvector optimized)",
        "descriere_task": "Implementează endpoint-ul de căutare vectorială folosind `pgvector` cu filtre metadata eficiente.\n\n**Query Pattern:**\n```sql\nSELECT p.id, p.title, 1 - (e.embedding <=> $1) as similarity\nFROM prod_embeddings e\nJOIN prod_core p ON e.product_id = p.id\nWHERE e.embedding_type = 'title_brand'\n  AND p.shop_id = $2 -- RLS enforce\nORDER BY e.embedding <=> $1\nLIMIT $3;\n```\n\n**Optimization:**\n- Asigură-te că `shop_id` filter este eficient (Composite Index sau Partitioning).\n- Folosește `SET LOCAL hnsw.ef_search = 64` înainte de query critic.",
        "cale_implementare": "apps/backend-worker/src/processors/ai/search.ts",
        "contextul_anterior": "Înlocuiește vechea abordare Redis. Postgres este singura sursă.",
        "validare_task": "Results matches expected similarity. EXPLAIN ANALYZE arată folosirea indexului HNSW.",
        "outcome_task": "Căutare rapidă direct din DB.",
        "restrictii_antihalucinatie": "Nu uita filtrul de tenant (shop_id)."
    },
    {
        "id_task": "F6.2.3",
        "denumire_task": "Redis Rate Limiter (Token Bucket) & Cost Control",
        "descriere_task": "Implementează controlul costurilor pentru generarea de embeddings (OpenAI) folosind Redis strict pentru countere.\n\n**Mecanism:**\n- Token Bucket per shop (ex: 1000 embeddings/hour).\n- Verificare pre-flight înainte de upsert/query.\n- Chei Redis: `rate:embed:{shop_id}`.\n\n**NU stocăm vectori în Redis.**",
        "cale_implementare": "packages/ai-engine/src/openai/rate-limiter.ts",
        "contextul_anterior": "Protecție împotriva abuzului/costurilor imprevizibile.",
        "validare_task": "Limita atinsă → reject request cu 429.",
        "outcome_task": "Control bugetar strict.",
        "restrictii_antihalucinatie": "Nu bloca thread-ul principal."
    },
    {
        "id_task": "F6.2.4",
        "denumire_task": "Exact Match Cache (Redis) pentru query-uri frecvente",
        "descriere_task": "Cache simplu (Key-Value) pentru rezultatele finale ale căutării (JSON), pentru a evita hit-uri repetate în DB/OpenAI pentru aceleași interogări.\n\n**Store:** `cache:search:{shop_id}:{hash(query_text)}` -> JSON Result.\n**TTL:** 1-24 ore (în funcție de volatilitatea catalogului).\n**Invalidare:** La update produs, șterge cache keys relevante (sau lasă TTL).",
        "cale_implementare": "apps/backend-worker/src/processors/ai/cache.ts",
        "contextul_anterior": "Optimizare pentru 'hot queries' (ex: 'iphone case').",
        "validare_task": "Second hit → 0ms DB latency, result from Redis.",
        "outcome_task": "Reducere load DB pentru trafic repetitiv.",
        "restrictii_antihalucinatie": "Nu fă cache la vectori, doar la rezultatul final (product list)."
    }
    ]
    ```

### F6.3: Observabilitate + testare + hardening (aliniat cu F4/F5)

    ```JSON
    [
    {
        "id_task": "F6.3.1",
        "denumire_task": "OTel pentru AI pipeline (spans/metrics/events, fără high-cardinality labels)",
        "descriere_task": "Instrumentează: enqueue→batch_build→batch_submit→poll→download→parse→db_upsert→vector_query. Metrici: ai.backlog_items, ai.batch_age_seconds, ai.items_processed_total, ai.errors_total, ai.query_latency_ms. Fără shop_domain în metric labels (shop_id doar în span attributes).",
        "cale_implementare": "apps/backend-worker/src/ + packages/ai-engine/src/",
        "contextul_anterior": "F3.4/F4.4/F5.3 au standard OTel; F6 trebuie să-l respecte.",
        "validare_task": "Traces coerente; metrici disponibili; nu există labels cu cardinalitate mare.",
        "outcome_task": "Debugging și ops complete pentru AI.",
        "restrictii_antihalucinatie": "Nu include payload/text query în metric labels sau logs."
    },
    {
        "id_task": "F6.3.2",
        "denumire_task": "Testare unit (node:test) pentru hashing, JSONL writer, parsing rezultate",
        "descriere_task": "Teste determinism content_hash, normalizare text, generare JSONL batch, parsare output și mapare custom_id→entity. Runner: node --test.",
        "cale_implementare": "apps/backend-worker/src/ + packages/ai-engine/src/",
        "contextul_anterior": "Standard proiect: node:test pe backend (F0/F1).",
        "validare_task": "Toate testele trec în CI; acoperire pe componente critice.",
        "outcome_task": "Bază solidă de regresie pentru AI.",
        "restrictii_antihalucinatie": "Nu folosi Jest."
    },
    {
        "id_task": "F6.3.3",
        "denumire_task": "Integration tests (containers) pentru pgvector + Redis cache + Postgres RLS + provider mock",
        "descriere_task": "Teste end-to-end: embeddings persistate în Postgres cu RLS (pgvector), Redis folosit doar pentru cache rezultate, query KNN cu FILTER shop_id. OpenAI mock (fără dependență de serviciu extern).",
        "cale_implementare": "apps/backend-worker/src/ + packages/ai-engine/src/",
        "contextul_anterior": "F5.4 cere CI-friendly fără Shopify real; aplicăm același principiu pentru OpenAI.",
        "validare_task": "Rulează local/CI cu containere; confirmă izolare multi-tenant.",
        "outcome_task": "Încredere că pipeline-ul AI funcționează fără servicii externe.",
        "restrictii_antihalucinatie": "Nu apela OpenAI real în CI."
    },
    {
        "id_task": "F6.3.4",
        "denumire_task": "Knobs + runbook minim (operare): schedule, throttling, kill switch, backfill",
        "descriere_task": "Definește variabile de config (model, dims, max_items_per_shop_per_day, max_global_batches, query_timeout_ms, cache_ttl). Documentează runbook: cum oprești pipeline-ul, cum reindexezi, cum investighezi backlog.",
        "cale_implementare": "Docs/ + apps/backend-worker/src/",
        "contextul_anterior": "F0/F7 cer discipline DevOps; F6 trebuie să fie operabilă, nu doar funcțională.",
        "validare_task": "Config poate fi schimbat fără redeploy major (env); runbook verificabil.",
        "outcome_task": "F6 devine producție-ready din perspectiva operării.",
        "restrictii_antihalucinatie": "Nu hardcoda limite; nu porni backfill fără kill switch."
    },
    {
        "id_task": "F6.3.5",
        "denumire_task": "Performance Test Harness (Vector Search Latency)",
        "descriere_task": "Script de load testing (k6 sau custom node) care bombardează API-ul de search cu query-uri sintetice. Validează SLA: p95 < 100ms pentru cached queries și < 300ms pentru uncached (cu embedding generation).",
        "cale_implementare": "tests/performance/vector-search-load.ts",
        "contextul_anterior": "Fără măsurători, 'latență mică' e doar o promisiune.",
        "validare_task": "Rulează testul în CI/staging; generează raport latență.",
        "outcome_task": "Certitudine asupra performanței înainte de producție.",
        "restrictii_antihalucinatie": "Nu ignora latența de rețea în măsurători."
    }
    ]
    ```

### F6.4: AI Search Playground

    ```JSON
    [
    {
        "id_task": "F6.4.1",
        "denumire_task": "Search UI: Sidebar Filters",
        "descriere_task": "Panou stânga: Textarea pentru query. Slider pentru Threshold (0.1-1.0). Input number pentru Limit. Switch pentru JSON Metadata. Buton 'Execută' full-width.",
        "cale_implementare": "/apps/web-admin/app/routes/app.search.tsx",
        "contextul_anterior": "Vectori gata.",
        "validare_task": "Formularul trimite parametrii corecți.",
        "outcome_task": "Controale căutare.",
        "restrictii_antihalucinatie": "Slider precis 0.05 step."
    },
    {
        "id_task": "F6.4.2",
        "denumire_task": "Search UI: Results Grid & JSON Modal",
        "descriere_task": "Panou dreapta: Grid de carduri. Fiecare card: Thumbnail, Titlu, Preț, Badge Scor. Click pe card deschide `Dialog` cu JSON-ul complet al vectorului.",
        "cale_implementare": "/apps/web-admin/app/components/domain/vector-result.tsx",
        "contextul_anterior": "Filtre gata.",
        "validare_task": "Rezultatele apar cu scorul colorat (Verde > 0.9).",
        "outcome_task": "Vizualizare rezultate AI.",
        "restrictii_antihalucinatie": "Afișare clară a scorului."
    },
    {
        "id_task": "F6.4.3",
        "denumire_task": "Search: Debounce pe input query (300ms)",
        "descriere_task": "Implementare useDebounce hook cu 300ms delay. Nu trimite request la fiecare keystroke. Loading indicator subtle în input (spinner în dreapta). Afișare 'Typing...' în results area în timpul debounce.",
        "cale_implementare": "/apps/web-admin/app/hooks/use-debounce.ts + /apps/web-admin/app/routes/app.search.tsx",
        "contextul_anterior": "Search UI basic gata (F6.4.1-2).",
        "validare_task": "Network tab arată un singur request după 300ms de la ultima tastă. UX smooth fără flickering.",
        "outcome_task": "Performanță optimă și reducere load pe backend.",
        "restrictii_antihalucinatie": "Nu folosiți setTimeout manual - useDebounce hook standardizat."
    },
    {
        "id_task": "F6.4.4",
        "denumire_task": "Search: Recent Searches (local storage)",
        "descriere_task": "Salvare ultimele 10 queries în localStorage (deduplicate). Dropdown sub input care apare la focus cu click to reuse. Clear history button (icon X). Persistență cross-session. Afișare timestamp 'searched X ago'.",
        "cale_implementare": "/apps/web-admin/app/hooks/use-recent-searches.ts + /apps/web-admin/app/components/domain/recent-searches-dropdown.tsx",
        "contextul_anterior": "Debounce gata (F6.4.3).",
        "validare_task": "Queries salvate persistă după refresh. Click populează input și execută search. Clear șterge totul.",
        "outcome_task": "UX îmbunătățit pentru queries repetitive.",
        "restrictii_antihalucinatie": "Limită strictă 10 entries. Nu stocați date sensibile în localStorage."
    },
    {
        "id_task": "F6.4.5",
        "denumire_task": "Search: Filters avansate (vendor, price range, category)",
        "descriere_task": "Extend sidebar cu: multi-select vendors (checkbox list cu search), price range slider (min-max cu input numeric), category tree select (collapsible hierarchy). Filters se combină cu query vectorial. Badge count pe fiecare filter activ. Reset all filters button.",
        "cale_implementare": "/apps/web-admin/app/components/domain/search-filters.tsx + /apps/web-admin/app/routes/app.search.tsx",
        "contextul_anterior": "Recent searches gata (F6.4.4).",
        "validare_task": "Filtrele se aplică corect. Rezultatele reflectă combinația query + filters. URL params sync pentru shareable search.",
        "outcome_task": "Căutare precisă cu multiple criterii.",
        "restrictii_antihalucinatie": "Vendors și categories trebuie încărcate dinamic din API, nu hardcodate."
    },
    {
        "id_task": "F6.4.6",
        "denumire_task": "Search: Export Results (CSV, JSON)",
        "descriere_task": "Buton 'Export' care apare când există rezultate. Format selection modal: CSV sau JSON. Download instant pentru seturi mici (<1000). Pentru seturi mari: generare async cu progress și notification când e gata. Copy to clipboard alternativă pentru JSON.",
        "cale_implementare": "/apps/web-admin/app/components/domain/export-results-modal.tsx + /apps/web-admin/app/utils/export-helpers.ts",
        "contextul_anterior": "Filters avansate gata (F6.4.5).",
        "validare_task": "CSV deschide corect în Excel. JSON valid parsabil. Download funcționează în toate browserele.",
        "outcome_task": "Extragere date pentru analiză externă.",
        "restrictii_antihalucinatie": "Includeți doar câmpurile relevante în export, nu întregul obiect. Respectați limita de export."
    }
    ]
    ```

### F6.5: Settings & Configuration Page

    ```JSON
    [
    {
        "id_task": "F6.5.1",
        "denumire_task": "Settings Page: General (shop info, preferences)",
        "descriere_task": "Pagină settings cu tabs design. Tab General: shop name (read-only din API), timezone selector, language preference. Persistare în localStorage + backend pentru preferințe user.",
        "cale_implementare": "/apps/web-admin/app/routes/app.settings.tsx + /apps/web-admin/app/routes/app.settings.general.tsx",
        "contextul_anterior": "Layout și navigare gata din F3.5. OAuth gata din F3.2.",
        "validare_task": "Settings page accesibilă. Timezone change persistă după refresh.",
        "outcome_task": "Configurare basic pentru preferințe utilizator.",
        "restrictii_antihalucinatie": "Shop info e read-only. NU permiteți modificări care ar trebui făcute în Shopify Admin.",
        "prioritate": "P2"
    },
    {
        "id_task": "F6.5.2",
        "denumire_task": "Settings Page: API & Webhooks",
        "descriere_task": "Tab API: afișare status conexiune Shopify (green/yellow/red), token expiry warning, webhook URLs configurate (read-only), test webhook button care trimite event și confirmă primire.",
        "cale_implementare": "/apps/web-admin/app/routes/app.settings.api.tsx + /apps/web-admin/app/components/domain/WebhookTester.tsx",
        "contextul_anterior": "Webhooks implementate în F3.3. OAuth tokens în F3.2.",
        "validare_task": "Status afișează corect. Test webhook returns success/failure feedback.",
        "outcome_task": "Vizibilitate asupra stării integrării Shopify.",
        "restrictii_antihalucinatie": "NU expuneți API secret sau token values - doar status.",
        "prioritate": "P2"
    },
    {
        "id_task": "F6.5.3",
        "denumire_task": "Settings Page: Queue Configuration",
        "descriere_task": "Tab Queues: adjust concurrency limits (cu warning despre impact), retry policies (max attempts, backoff), DLQ retention days. Admin-only access.",
        "cale_implementare": "/apps/web-admin/app/routes/app.settings.queues.tsx",
        "contextul_anterior": "BullMQ Pro gata din F4. DLQ policies din F4.1.4.",
        "validare_task": "Changes to concurrency apply immediately. Warning modal on risky changes.",
        "outcome_task": "Fine-tuning operațional pentru queues.",
        "restrictii_antihalucinatie": "NU permiteți concurrency < 1 sau > 50. Validare pe server obligatorie.",
        "prioritate": "P3"
    },
    {
        "id_task": "F6.5.4",
        "denumire_task": "Settings Page: AI Configuration",
        "descriere_task": "Tab AI: model selection (dropdown cu versiuni disponibile), embedding batch size (default 100), similarity threshold default pentru search (0.7-0.95 slider).",
        "cale_implementare": "/apps/web-admin/app/routes/app.settings.ai.tsx",
        "contextul_anterior": "AI engine gata din F6.1-F6.2. Vector search din F6.2.",
        "validare_task": "Model selection salvează. Threshold slider updates și persistă.",
        "outcome_task": "Customizare AI behavior per shop.",
        "restrictii_antihalucinatie": "Threshold range 0.7-0.95 (sub 0.7 = prea multe results, peste 0.95 = prea puține).",
        "prioritate": "P3"
    }
    ]
    ```

### F6.6: Products UI (Pagină Principală Produse)

    ```JSON
    [
    {
        "id_task": "F6.6.1",
        "denumire_task": "Products Page: Lista virtualizată produse",
        "descriere_task": "Pagină /app/products. Tabel virtualizat (react-window) pentru 1M+ produse. Coloane: thumbnail, title, vendor, status, variants count, last synced.",
        "cale_implementare": "/apps/web-admin/app/routes/app.products.tsx + /apps/web-admin/app/components/domain/ProductsTable.tsx",
        "contextul_anterior": "Database schema există din F2. API endpoints din F3.",
        "validare_task": "Tabelul randează smooth 10k+ produse fără lag. Scroll virtualizat funcționează.",
        "outcome_task": "Pagină principală produse performantă pentru volume mari.",
        "restrictii_antihalucinatie": "NU încărcați toate produsele în memorie. Paginare + virtualizare obligatorii.",
        "prioritate": "P1 - PAGINA PRINCIPALĂ"
    },
    {
        "id_task": "F6.6.2",
        "denumire_task": "Products Page: Filters sidebar",
        "descriere_task": "Sidebar stânga: filter by vendor (multi-select), filter by status (active/draft/archived), filter by sync status, filter by category.",
        "cale_implementare": "/apps/web-admin/app/components/domain/ProductsFilters.tsx",
        "contextul_anterior": "Products table gata (F6.6.1).",
        "validare_task": "Filtrele modifică URL params și re-filtrează tabelul. Reset clears all.",
        "outcome_task": "Navigare eficientă prin catalog mare.",
        "restrictii_antihalucinatie": "Filters persistă în URL pentru share/bookmark.",
        "prioritate": "P1"
    },
    {
        "id_task": "F6.6.3",
        "denumire_task": "Products Page: Search (full-text + vector)",
        "descriere_task": "Search bar cu toggle: 'Exact match' vs 'Semantic search'. Integrare cu AI Search backend.",
        "cale_implementare": "/apps/web-admin/app/routes/app.products.tsx",
        "contextul_anterior": "AI Search gata din F6.1-F6.3. Products page din F6.6.1.",
        "validare_task": "Toggle schimbă tipul de search. Rezultatele reflectă modul ales.",
        "outcome_task": "Căutare hibridă exact + vector.",
        "restrictii_antihalucinatie": "Debounce obligatoriu (vezi F6.4.3).",
        "prioritate": "P2"
    },
    {
        "id_task": "F6.6.4",
        "denumire_task": "Products Page: Product Detail Drawer/Modal",
        "descriere_task": "Click pe produs → drawer dreapta cu: toate metafields, variante expandabile, sync history, actions (force sync, view in Shopify).",
        "cale_implementare": "/apps/web-admin/app/components/domain/ProductDetailDrawer.tsx",
        "contextul_anterior": "Products table gata (F6.6.1).",
        "validare_task": "Drawer deschide smooth. Metafields afișate corect. Force sync funcționează.",
        "outcome_task": "Acces rapid la detalii produs fără navigare.",
        "restrictii_antihalucinatie": "NU încărcați toate variantele la deschidere - lazy load.",
        "prioritate": "P2"
    },
    {
        "id_task": "F6.6.5",
        "denumire_task": "Products Page: Bulk Selection + Actions",
        "descriere_task": "Checkbox selection. Actions: force sync selected, export selected, compare selected (side by side).",
        "cale_implementare": "/apps/web-admin/app/components/domain/ProductsBulkActions.tsx",
        "contextul_anterior": "Products table cu selection gata (F6.6.1).",
        "validare_task": "Select All funcționează pe paginare. Actions aplică pe toate selectate.",
        "outcome_task": "Operații în masă pe produse.",
        "restrictii_antihalucinatie": "Limită max 100 produse per operație bulk.",
        "prioritate": "P2"
    },
    {
        "id_task": "F6.6.6",
        "denumire_task": "Products Page: Sync Status Indicators",
        "descriere_task": "Badge per produs: 'Synced', 'Pending', 'Error', 'Never synced'. Tooltip cu last sync time și error message if any.",
        "cale_implementare": "/apps/web-admin/app/components/domain/SyncStatusBadge.tsx",
        "contextul_anterior": "Products table gata (F6.6.1). Sync jobs din F5.",
        "validare_task": "Badge-uri afișează status corect. Tooltip arată detalii on hover.",
        "outcome_task": "Vizibilitate clară status sincronizare per produs.",
        "restrictii_antihalucinatie": "Status din cache Redis, nu query DB per produs.",
        "prioritate": "P2"
    },
    {
        "id_task": "F6.6.7",
        "denumire_task": "Product Detail Page (Dedicated Route)",
        "descriere_task": "Pagină dedicată /app/products/:id (nu doar drawer). Secțiuni: Overview (imagine, titlu, vendor, status), Variants Table (toate variantele cu inventar), Metafields Browser (grupate per namespace), Sync History (timeline), AI Insights (embeddings status, semantic neighbors).",
        "cale_implementare": "/apps/web-admin/app/routes/app.products.$id.tsx",
        "contextul_anterior": "F6.6.4 are drawer, dar lipsește pagină full pentru deep dive.",
        "validare_task": "Pagina încarcă complet în <500ms. Toate secțiunile funcționale.",
        "outcome_task": "Deep inspection pentru singur produs.",
        "restrictii_antihalucinatie": "Lazy-load secțiuni on scroll, nu toate datele upfront.",
        "prioritate": "P1"
    },
    {
        "id_task": "F6.6.8",
        "denumire_task": "Product Editor Page",
        "descriere_task": "Pagină /app/products/:id/edit pentru editare metafields și AI attributes. Permite editare title_master, description_master din PIM. Form validation cu Zod schema. Optimistic updates cu React Router actions.",
        "cale_implementare": "/apps/web-admin/app/routes/app.products.$id.edit.tsx",
        "contextul_anterior": "F6.6.7 Product Detail ca read-only base.",
        "validare_task": "Form salvează modificări în DB. Validation errors afișate inline.",
        "outcome_task": "Editare manuală produse în app.",
        "restrictii_antihalucinatie": "NU editați direct Shopify din UI - doar datele locale PIM.",
        "prioritate": "P2"
    },
    {
        "id_task": "F6.6.9",
        "denumire_task": "Products Import UI (CSV/JSON)",
        "descriere_task": "Pagină /app/products/import. Upload CSV sau JSON cu produs data. Preview parsed data în tabel. Validation errors highlighted per row. Dry-run mode pentru preview fără save. Progress tracking pentru import large.",
        "cale_implementare": "/apps/web-admin/app/routes/app.products.import.tsx",
        "contextul_anterior": "F3.9.14 FileUpload component gata.",
        "validare_task": "Import 1000 produse din CSV în <30s. Errors per row afișate corect.",
        "outcome_task": "Bulk import produse din fișiere externe.",
        "restrictii_antihalucinatie": "Parseați pe server, nu în browser pentru files mari.",
        "prioritate": "P2"
    },
    {
        "id_task": "F6.6.10",
        "denumire_task": "Products Export UI",
        "descriere_task": "Export button pe Products page. Modal cu options: format (CSV/JSON/Excel), columns to include (checkboxes), include variants (yes/no), filters applied (export doar filtrele curente). Download async pentru exports mari cu progress.",
        "cale_implementare": "/apps/web-admin/app/components/domain/ProductsExportModal.tsx",
        "contextul_anterior": "F6.6.1 Products page gata cu filtre.",
        "validare_task": "Export 10k produse generează file corect. Download triggered la completare.",
        "outcome_task": "Export produse pentru analysis externă.",
        "restrictii_antihalucinatie": "Export pe server, stream direct to download, nu in-memory.",
        "prioritate": "P2"
    }
    ]
    ```

## Faza F7: CI/CD, Observabilitate și Producție (Săptămâna 10-11)

Durată: Săptămâna 10–11
Obiectiv: hardening, build/publish, deploy, migrații, alerte, DR, Securitate Supply Chain.

### F7.0: Foundation Producție (platformă, medii, Ops, secrete)

    ```JSON
    [
    {
        "id_task": "F7.0.1",
        "denumire_task": "ADR: platformă de deploy + topologie medii (dev/staging/prod) + convenții (naming, DNS, domains)",
        "descriere_task": "Documentează decizia de platformă (bare metal, Docker Compose + systemd) și backend-ul de observabilitate. Definește deploy units: api (backend HTTP) separat de worker (batch/queues), ambele din aceeași imagine sau imagini separate. Stabilește topologia: rețea internă pentru DB/Redis/OpenBAO, expus public doar reverse proxy; worker scalat la 10 instanțe în staging/prod.",
        "cale_implementare": "Docs/adr/ADR-0001-platforma-deploy.md + Docs/adr/ADR-0002-topologie-medii.md",
        "contextul_anterior": "F0 definește standarde; F1 are doar local config/Docker. Pentru F7 trebuie decizie explicită ca să nu facem hardening pe o țintă ambiguă.",
        "validare_task": "ADR aprobat; matrice dev/staging/prod definită; backend obs ales.",
        "outcome_task": "Ținta de producție este clară și reproductibilă; elimină ambiguitatea înainte de implementare.",
        "restrictii_antihalucinatie": "Nu începe implementarea Automation fără ADR aprobat. Nu definește medii fără staging înainte de prod."
    },
    {
        "id_task": "F7.0.2",
        "denumire_task": "Scaffold ops automation (bare metal) + Docker Compose per mediu + systemd",
        "descriere_task": "Creează structura de automatizare pentru bare metal: Ansible (provisioning host), Docker Compose bundles (staging/prod), systemd units (start/stop/restart), și un mecanism de “deploy lock” (evită două deploy-uri simultane). Definește explicit worker ca serviciu separat scalat la 10 instanțe (docker compose up -d --scale worker=10). Definește două rețele: public (doar reverse proxy) și internal (DB/Redis/OpenBAO/api/worker), cu internal: true pentru izolarea traficului.",
        "cale_implementare": "Infra/ops/ansible/ + Infra/ops/compose/staging + Infra/ops/compose/prod",
        "contextul_anterior": "F1/F2 rulează local; F7 trebuie să fie reproducibil pe bare metal (self-hosted).",
        "validare_task": "Automation-ul funcționează pe un VM curat (staging); deploy lock previne race conditions; systemd asigură restart la boot.",
        "outcome_task": "Infrastructura devine declarativă și automată, fără dependențe de cloud provider.",
        "restrictii_antihalucinatie": "Nu folosi Terraform/Pulumi pentru bare metal dacă nu e strict necesar (Ansible e suficient). Nu păstra state local."
    },
    {
        "id_task": "F7.0.3",
        "denumire_task": "Provisioning PostgreSQL 18.1 (self-hosted) + parametri operaționali pentru 10 workers",
        "descriere_task": "Rulează PostgreSQL 18.1 pe bare metal (preferabil dedicat) cu conectivitate restrânsă pe rețeaua internă, TLS unde e cazul, roluri separate (app runtime vs migrations) și audit logging. Dimensionează conexiunile pentru 10 worker containers: setează DB_POOL_SIZE per container și aliniază max_connections (sau pune PgBouncer pentru a plafona conexiunile). Documentează explicit formula și pragurile (alertă pe pool saturation).",
        "cale_implementare": "Infra/ops/db/ + Docs/runbooks/db-ops.md",
        "contextul_anterior": "F2 stabilește PG18.1 și RLS; F7 trebuie să asigure operarea în producție.",
        "validare_task": "Conexiunea din aplicație funcționează prin TLS; rolul runtime nu poate executa DDL; backup-ul este activ.",
        "outcome_task": "Postgres production-grade, sigur și operabil.",
        "restrictii_antihalucinatie": "Nu folosi versiuni diferite de PostgreSQL. Nu expune DB public."
    },
    {
        "id_task": "F7.0.4",
        "denumire_task": "Provisioning Redis 8.4 (cu RediSearch/RedisJSON) + strategie durabilitate",
        "descriere_task": "Provision Redis 8.4 (sau Redis Stack compatibil) pentru: BullMQ, rate limiting, vector search. Configurează TLS, persistence (AOF/snapshots unde are sens), limite memorie/eviction policy și plan de failover. Clarifică dacă vector search rulează în același cluster Redis cu BullMQ sau separat (recomandat separat la scară mare).",
        "cale_implementare": "Infra/ops/redis + Docs/runbooks/redis-ops.md",
        "contextul_anterior": "F1.2 pornește Redis local; F4/F6 depind critic de Redis în prod.",
        "validare_task": "Redis acceptă conexiuni TLS; modulele necesare pentru FT.* sunt disponibile; failover test minim documentat.",
        "outcome_task": "Redis production-grade pentru cozi + vector search.",
        "restrictii_antihalucinatie": "Nu folosi Redis fără module dacă ai F6.2 activ. Nu amesteca secrete în config repo."
    },
    {
        "id_task": "F7.0.5",
        "denumire_task": "Secret Management end-to-end (staging/prod) + rotație + audit",
        "descriere_task": "Integrează un Secret Manager (staging/prod) ca sursă unică de adevăr și injectează secrete în runtime (aplicații) + CI. Include: SHOPIFY_API_KEY/SECRET, NPM_TASKFORCESH_TOKEN, BULLMQ_PRO_TOKEN, OPENAI_API_KEY, ENCRYPTION_KEY_256, OTEL_EXPORTER_OTLP_ENDPOINT etc. Definește rotația și procedura de emergency rotation (break-glass).",
        "cale_implementare": "Infra/ops/scripts/verify-deploy.sh + Docs/runbooks/secrets-rotation.md",
        "contextul_anterior": "F0 și Docs cer explicit secret manager; F7 trebuie să îl implementeze.",
        "validare_task": "Niciun secret nu este în repo/imagini; rotația unui secret nu cere rebuild de imagine; audit trail există.",
        "outcome_task": "Secrete gestionate corect pentru industrie.",
        "restrictii_antihalucinatie": "Nu folosi secrete long-lived în GitHub Actions. Nu comite fișiere .env cu valori reale."
    },
    {
        "id_task": "F7.0.6",
        "denumire_task": "Config validation la startup + feature flags (kill switches) pentru Bulk/AI",
        "descriere_task": "Adaugă validare strictă a config-ului (env schema) pentru backend-worker și web-admin, plus feature flags pentru oprire controlată: bulk ingestion, webhooks processing, AI pipeline, vector sync, etc. Include și \"read-only mode\" pentru incidente.",
        "cale_implementare": "packages/config + apps/backend-worker/src/ + apps/web-admin/",
        "contextul_anterior": "F4–F6 introduc sisteme grele (bulk/AI) care trebuie oprite rapid în prod.",
        "validare_task": "Aplicația refuză să pornească fără env obligatorii; kill switch oprește sigur pipeline-ul fără crash loops.",
        "outcome_task": "Operare sigură și controlată în incidente.",
        "restrictii_antihalucinatie": "Nu hardcoda limite; nu activa implicit bulk/AI în prod fără flags."
    },
    {
        "id_task": "F7.0.7",
        "denumire_task": "Ingress/TLS/DNS + politici edge (HTTPS only, CORS, rate limits)",
        "descriere_task": "Configurează expunerea aplicației: TLS automat, redirect HTTP->HTTPS, DNS automat, politici CORS pentru embedded admin, rate limiting la edge, și restricții pentru endpoint-uri interne (health/metrics).",
        "cale_implementare": "Infra/networking/ + Infra/ops/compose/",
        "contextul_anterior": "F3 expune HTTP; în prod trebuie hardening de edge.",
        "validare_task": "Toate endpoint-urile publice sunt HTTPS; endpoint-uri interne nu sunt publice; CORS este strict și testat.",
        "outcome_task": "Expunere publică sigură, aliniată standardelor.",
        "restrictii_antihalucinatie": "Nu expune OTLP/metrics public. Nu permite origini CORS wildcard în prod."
    }
    ]
    ```

### F7.1: Observabilitate prod (OTel hardening, SLO/alerte, runbooks)

    ```JSON
    [
    {
        "id_task": "F7.1.1",
        "denumire_task": "Deploy OpenTelemetry Collector (prod) + pipeline traces/metrics/logs",
        "descriere_task": "Deploy collector în staging/prod; configurează recepția OTLP și export către backend observabilitate (Tempo/Jaeger/Prometheus/Grafana sau echivalent). Standardizează resource attributes: service.name, service.version, deployment.environment, git.sha.",
        "cale_implementare": "Infra/observability/otel-collector/ + Infra/ops/compose/",
        "contextul_anterior": "OTel există din F3.4/F4.4/F5.3/F6.3; F7 îl face production-grade.",
        "validare_task": "Traces/metrics/logs ajung în backend; service.version corespunde imaginii deployate; staging și prod sunt separate.",
        "outcome_task": "Observabilitate centralizată în prod.",
        "restrictii_antihalucinatie": "Nu trimite payload-uri sensibile în traces/logs. Nu exporta către un endpoint neautentificat."
    },
    {
        "id_task": "F7.1.2",
        "denumire_task": "Sampling strategy + guardrails cardinalitate + redaction PII",
        "descriere_task": "Definește sampling adaptiv (head/tail după platformă), limite pentru high-cardinality (nu shop_domain în labels), redaction pentru PII/secrete, și convenții log (JSON structurat).",
        "cale_implementare": "apps/backend-worker/src/monitoring/ + Infra/observability/",
        "contextul_anterior": "Docs cer explicit evitarea labels cu cardinalitate mare; F6.3 are aceeași regulă.",
        "validare_task": "Metric labels au cardinalitate controlată; sampling nu depășește bugetul; niciun secret nu apare în logs.",
        "outcome_task": "Cost control + siguranță + semnal util.",
        "restrictii_antihalucinatie": "Nu activa sampling 100% în prod fără justificare. Nu loga token-uri."
    },
    {
        "id_task": "F7.1.3",
        "denumire_task": "Dashboards pentru: HTTP, Webhooks, BullMQ, Bulk pipeline, AI pipeline, DB/Redis health",
        "descriere_task": "Creează dashboards pentru: p95/p99 latență, rate de erori, queue depth per group, stalled/retry, bulk lag, bytes/sec, DB pool saturation, Redis memory/latency, vector search latency. Include și cost/budget pentru OpenAI Batch.",
        "cale_implementare": "Infra/observability/dashboards/",
        "contextul_anterior": "F4/F5/F6 introduc metrice; F7 trebuie să le facă vizibile ops.",
        "validare_task": "Dashboards sunt complete și folosite într-un \"game day\"; includ link-uri către runbooks.",
        "outcome_task": "Vizibilitate enterprise asupra sistemului.",
        "restrictii_antihalucinatie": "Nu defini dashboards fără metrici reale; nu include shop_id ca label de metric."
    },
    {
        "id_task": "F7.1.4",
        "denumire_task": "SLO-uri + alerte + routing (paging) pentru incidente",
        "descriere_task": "Definește SLO-uri măsurabile (ex: availability API, webhook ingest p95, queue lag max, bulk completion age). Configurează alerte cu praguri clare și routing către canale/on-call; include alerte pentru Postgres/Redis.",
        "cale_implementare": "Infra/observability/alerts/ + Docs/runbooks/",
        "contextul_anterior": "F7 obiectiv = producție; fără SLO/alerte nu e producție-ready.",
        "validare_task": "Simulează failure (ex: Redis down, 429 storm) și confirmă alerte + runbook utilizabil.",
        "outcome_task": "Incident response pregătit.",
        "restrictii_antihalucinatie": "Nu alerta pe semnale zgomotoase fără deduplicare. Nu seta praguri fără justificare."
    },
    {
        "id_task": "F7.1.5",
        "denumire_task": "Healthchecks (liveness/readiness) + dependency checks + synthetic probes",
        "descriere_task": "Definește endpoint-uri de health (separate liveness vs readiness) și probe sintetice (staging/prod) care verifică flux minim: HTTP->Redis->Postgres (fără a atinge Shopify real).",
        "cale_implementare": "apps/backend-worker/src/ + Infra/ops/compose/",
        "contextul_anterior": "F5.4 cere CI-friendly fără dependențe externe; la fel pentru probes.",
        "validare_task": "Deploy rulează cu probes; readiness cade când dependențele critice sunt indisponibile; probele nu produc load excesiv.",
        "outcome_task": "Operare stabilă și rollout sigur.",
        "restrictii_antihalucinatie": "Nu expune probe interne public. Nu face probe care scriu date persistente."
    }
    ]
    ```

### F7.1.x: Loki+Grafana Log Shipping (CONFORM Problems & Fixes.md)

> [!IMPORTANT]
> **PRIORITATE P1:** Aceste task-uri adresează GAP 2.2 din auditul de observabilitate. Stack-ul Loki+Grafana este OBLIGATORIU pentru log aggregation și debugging în producție.

    ```JSON
    [
    {
        "id_task": "F7.1.1.1",
        "denumire_task": "Creare config/loki-config.yaml cu schema v13 și retenție 31 zile",
        "descriere_task": "**CONFORM Problems & Fixes.md - Gap 2.2:** Configurație Loki ≥3.6.3:\n\n```yaml\n# config/loki-config.yaml\nauth_enabled: false\n\nserver:\n  http_listen_port: 3100\n  grpc_listen_port: 9096\n\nlimits_config:\n  ingestion_rate_mb: 10\n  max_streams_per_user: 10000\n  retention_period: 744h  # 31 zile\n\nschema_config:\n  configs:\n    - from: 2025-01-01\n      store: tsdb\n      schema: v13\n      index:\n        prefix: index_\n        period: 24h\n\nstorage_config:\n  tsdb_shipper:\n    active_index_directory: /loki/index\n    cache_location: /loki/cache\n  filesystem:\n    directory: /loki/chunks\n```",
        "cale_implementare": "/Neanelu_Shopify/config/loki-config.yaml",
        "contextul_anterior": "OTel Collector există în F7.1.1 dar fără destinație concretă pentru logs.",
        "validare_task": "Loki pornește cu config-ul specificat. Endpoint /ready returnează 200.",
        "outcome_task": "Loki configurat pentru 31 zile retenție cu schema v13.",
        "restrictii_antihalucinatie": "Versiune Loki ≥3.6.3 obligatorie pentru schema v13."
    },
    {
        "id_task": "F7.1.1.2",
        "denumire_task": "Creare config/otel-collector-config.yaml cu Loki exporter",
        "descriere_task": "**OTel Collector ≥0.142.0:**\n\n```yaml\nreceivers:\n  otlp:\n    protocols:\n      grpc:\n        endpoint: 0.0.0.0:4317\n      http:\n        endpoint: 0.0.0.0:4318\n\nprocessors:\n  batch:\n    timeout: 5s\n    send_batch_size: 1000\n  memory_limiter:\n    limit_mib: 512\n\nexporters:\n  loki:\n    endpoint: http://loki:3100/loki/api/v1/push\n\nservice:\n  pipelines:\n    logs:\n      receivers: [otlp]\n      processors: [memory_limiter, batch]\n      exporters: [loki]\n```",
        "cale_implementare": "/Neanelu_Shopify/config/otel-collector-config.yaml",
        "contextul_anterior": "F7.1.1.1 a creat Loki config.",
        "validare_task": "OTel Collector pornește și poate conecta la Loki.",
        "outcome_task": "Pipeline logs: app → OTel → Loki complet.",
        "restrictii_antihalucinatie": "Memory limiter obligatoriu pentru a preveni OOM."
    },
    {
        "id_task": "F7.1.1.3",
        "denumire_task": "Adăugare services Loki + Grafana în docker-compose.observability.yml",
        "descriere_task": "**Docker Compose services:**\n\n```yaml\nservices:\n  loki:\n    image: grafana/loki:3.6.3\n    ports:\n      - \"65023:3100\"\n    volumes:\n      - ./config/loki-config.yaml:/etc/loki/config.yaml\n      - loki-data:/loki\n    healthcheck:\n      test: [\"CMD\", \"wget\", \"--spider\", \"-q\", \"http://localhost:3100/ready\"]\n\n  grafana:\n    image: grafana/grafana:12.3.1\n    ports:\n      - \"65024:3000\"\n    environment:\n      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD:-admin}\n    volumes:\n      - ./config/grafana/provisioning:/etc/grafana/provisioning\n```",
        "cale_implementare": "/Neanelu_Shopify/docker-compose.observability.yml",
        "contextul_anterior": "F7.1.1.1 și F7.1.1.2 definesc configurațiile.",
        "validare_task": "docker compose -f docker-compose.observability.yml up funcționează.",
        "outcome_task": "Stack observability containerizat.",
        "restrictii_antihalucinatie": "Porturi din range 65xxx conform standardului proiectului."
    },
    {
        "id_task": "F7.1.1.4",
        "denumire_task": "Creare Grafana provisioning (datasources Loki + Jaeger)",
        "descriere_task": "**Grafana Provisioning:**\n\n```yaml\n# config/grafana/provisioning/datasources/datasources.yaml\napiVersion: 1\ndatasources:\n  - name: Loki\n    type: loki\n    access: proxy\n    url: http://loki:3100\n    jsonData:\n      derivedFields:\n        - name: TraceID\n          matcherRegex: '\"traceId\":\"([a-f0-9]+)\"'\n          url: 'http://jaeger:16686/trace/${__value.raw}'\n          datasourceUid: jaeger\n  - name: Jaeger\n    type: jaeger\n    access: proxy\n    url: http://jaeger:16686\n    uid: jaeger\n```",
        "cale_implementare": "/Neanelu_Shopify/config/grafana/provisioning/",
        "contextul_anterior": "F7.1.1.3 adaugă Grafana în compose.",
        "validare_task": "Grafana pornește cu datasources configurate automat.",
        "outcome_task": "Grafana provizionat cu trace↔log correlation.",
        "restrictii_antihalucinatie": "derivedFields pentru trace correlation sunt OBLIGATORII."
    },
    {
        "id_task": "F7.1.1.5",
        "denumire_task": "Creare Grafana dashboard pentru logs (volume, errors, search)",
        "descriere_task": "Dashboard JSON cu panels: Log volume per service (bar chart), Error rate trend, Top 10 errors (table), Logs table cu search.",
        "cale_implementare": "/Neanelu_Shopify/config/grafana/provisioning/dashboards/logs-dashboard.json",
        "contextul_anterior": "F7.1.1.4 configurează datasources.",
        "validare_task": "Dashboard vizibil în Grafana. Toate panels afișează date.",
        "outcome_task": "Dashboard operațional pentru log analysis.",
        "restrictii_antihalucinatie": "Folosește variabile pentru filtering."
    },
    {
        "id_task": "F7.1.1.6",
        "denumire_task": "Documentare variabile environment pentru Loki+Grafana în .env.example",
        "descriere_task": "Adaugă în .env.example:\n```bash\n# Loki+Grafana Stack\nLOKI_VERSION=3.6.3\nGRAFANA_VERSION=12.3.1\nGRAFANA_ADMIN_PASSWORD=changeme_in_production\nLOKI_PORT=65023\nGRAFANA_PORT=65024\nLOKI_RETENTION_PERIOD=744h\n```",
        "cale_implementare": "/.env.example",
        "contextul_anterior": "Stack configurat; variabilele trebuie documentate.",
        "validare_task": ".env.example conține toate variabilele Loki+Grafana.",
        "outcome_task": "Onboarding clar pentru stack observability.",
        "restrictii_antihalucinatie": "NU pune parole reale în .env.example."
    }
    ]
    ```

### F7.1.3.x: DB/Redis Observability + SLI/SLO (CONFORM Problems & Fixes.md)

> [!IMPORTANT]
> **PRIORITATE P2:** Aceste task-uri adresează GAP 2.5 și GAP 2.8 din auditul de observabilitate. DB/Redis monitoring și SLI/SLO sunt necesare pentru operare enterprise.

    ```JSON
    [
    {
        "id_task": "F7.1.3.1",
        "denumire_task": "DB/Redis Observability: slow query logging, pool saturation, SLOWLOG export",
        "descriere_task": "**CONFORM Problems & Fixes.md - Gap 2.5:**\n\n**PostgreSQL configurație:**\n```sql\n-- postgresql.conf\nlog_min_duration_statement = 100  -- ms\nlog_statement = 'ddl'\nlog_connections = on\nlog_disconnections = on\n```\n\n**pg_stat_statements:**\n```sql\nCREATE EXTENSION IF NOT EXISTS pg_stat_statements;\n```\n\n**Pool saturation alert:** pool > 80% pentru > 5 min\n\n**Redis SLOWLOG export (job periodic):**\n```typescript\nconst slowLogs = await redis.slowlog('GET', 10);\nlogger.warn('Redis slow commands', { commands: slowLogs });\n```",
        "cale_implementare": "Infra/ops/db/ + packages/queue-manager/src/jobs/redis-slowlog.ts",
        "contextul_anterior": "F7.1.3 menționează dashboards dar fără detalii concrete pentru DB/Redis.",
        "validare_task": "1. Slow queries apar în logs\n2. pg_stat_statements returnează date\n3. Redis SLOWLOG exportat periodic",
        "outcome_task": "Vizibilitate completă asupra performanței DB/Redis.",
        "restrictii_antihalucinatie": "log_statement = 'all' ar genera prea mult log; folosește 'ddl' sau 'mod'."
    },
    {
        "id_task": "F7.1.3.2",
        "denumire_task": "Definire SLI/SLO concrete cu thresholds și alerte",
        "descriere_task": "**CONFORM Problems & Fixes.md - Gap 2.8:**\n\n**SLI-uri definite:**\n\n| SLI | Target (SLO) | Alertă |\n|-----|--------------|--------|\n| API Latency P99 | < 500ms | > 1s pentru 5 min |\n| API Error Rate | < 1% | > 5% pentru 2 min |\n| Bulk Sync Success | > 95% | < 90% pe batch |\n| Job Processing P95 | < 30s | > 60s |\n| Webhook Response | < 100ms | > 500ms |\n| DB Query P99 | < 100ms | > 500ms |\n\n**Implementare:**\n```yaml\ngroups:\n  - name: SLO Alerts\n    rules:\n      - alert: APILatencyHigh\n        expr: histogram_quantile(0.99, http_request_duration_seconds_bucket) > 1\n        for: 5m\n```",
        "cale_implementare": "Infra/observability/alerts/ + Docs/slo-definitions.md",
        "contextul_anterior": "F7.1.4 menționează SLO dar fără valori concrete.",
        "validare_task": "1. Alertele sunt configurate\n2. Simulează degradare și verifică alertă\n3. Dashboard SLO afișează burn rate",
        "outcome_task": "SLO-uri măsurabile și alertabile.",
        "restrictii_antihalucinatie": "SLO-urile trebuie să fie realiste pentru stadiul curent."
    }
    ]
    ```

### F7.2: Build & Supply Chain (Docker, SBOM, semnare, scanări)

    ```JSON
    [
    {
        "id_task": "F7.2.1",
        "denumire_task": "Docker multi-stage (monorepo pnpm) pentru apps/backend-worker (runtime hardening)",
        "descriere_task": "Optimizează build: pnpm workspaces, cache corect, runtime minimal, user non-root, `tini`, read-only filesystem unde posibil, healthcheck. Folosește Node.js 24.12.0 pin-uit (și digest) și build determinist pe baza lockfile.",
        "cale_implementare": "Dockerfile + Infra/docker/",
        "contextul_anterior": "F1.4 are docker smoke build; F7 finalizează producția.",
        "validare_task": "Imagine rulează; healthcheck trece; nu include devDependencies; dimensiune rezonabilă; pornește fără root.",
        "outcome_task": "Imagine producție sigură și eficientă.",
        "restrictii_antihalucinatie": "Nu folosi tag-uri 'latest'. Nu include secrete în imagine."
    },
    {
        "id_task": "F7.2.2",
        "denumire_task": "Build packaging pentru apps/web-admin (artifact/serving strategy)",
        "descriere_task": "Definește și implementează strategia de livrare a web-admin: container separat sau assets servite de un edge/static host. Asigură compatibilitatea embedded Shopify și setări CSP/CORS.",
        "cale_implementare": "apps/web-admin/ + Infra/ops/compose/",
        "contextul_anterior": "Docs indică web-admin separat; F7 trebuie să-l livreze coerent în prod.",
        "validare_task": "Staging deploy funcțional; iframe embedded funcționează; CSP nu rupe App Bridge.",
        "outcome_task": "Frontend livrat robust în producție.",
        "restrictii_antihalucinatie": "Nu amesteca build web-admin în imaginea worker dacă asta complică rollback-ul."
    },
    {
        "id_task": "F7.2.3",
        "denumire_task": "SBOM + semnare imagini + provenance/attestations",
        "descriere_task": "Generează SBOM la build (per imagine), semnează imaginile și publică attestations (provenance). Leagă service.version de git SHA și de digest-ul imaginii.",
        "cale_implementare": ".github/workflows/* + Infra/security/supply-chain/",
        "contextul_anterior": "Docs menționează SBOM în F7; aici îl operationalizăm.",
        "validare_task": "SBOM disponibil ca artifact; semnătura verificabilă; deploy folosește digest pin-uit.",
        "outcome_task": "Supply chain enterprise (auditabil).",
        "restrictii_antihalucinatie": "Nu publica imagini ne-semnate în prod. Nu face deploy pe tag mutabil."
    },
    {
        "id_task": "F7.2.4",
        "denumire_task": "Scanări securitate: deps + image + config (gating pe severity)",
        "descriere_task": "Rulează scanări complete (dependențe, container image, infra config/compose/ansible). Definește politici de gating (ex: block pe Critical/High ne-exceptate) și proces de excepții (timeboxed).",
        "cale_implementare": ".github/workflows/* + Infra/security/policies/",
        "contextul_anterior": "F1.4 avea scanări rapide; F7 cere scanări complete.",
        "validare_task": "PR/main pipeline blochează CVE critice; excepțiile sunt documentate și expiră.",
        "outcome_task": "Reducere risc securitate în producție.",
        "restrictii_antihalucinatie": "Nu ignora alertele fără excepție documentată. Nu dezactiva secret scanning."
    }
    ]
    ```

### F7.3: CI/CD complet (build/push/deploy, gating, migrații controlate)

    ```JSON
    [
    {
        "id_task": "F7.3.1",
        "denumire_task": "CI complet (PR): lint/typecheck/test + integration tests cu Postgres/Redis efemere",
        "descriere_task": "Extinde skeleton-ul minimal din `ci-pr.yml` într-un workflow complet `ci.yml` (sau suită): rulează teste unit (node:test) + integration (containere Postgres/Redis), plus build smoke pentru imagini. Folosește `ci-pr.yml` pentru fast feedback și `ci.yml` pentru merge gate riguros.",
        "cale_implementare": ".github/workflows/ci.yml",
        "contextul_anterior": "F1.4 a introdus skeleton; F5.4/F6.3 cer tests CI-friendly fără servicii externe.",
        "validare_task": "CI rulează stabil; nu apelează Shopify/OpenAI real; containerele pornesc rapid.",
        "outcome_task": "Garanție de calitate înainte de CD.",
        "restrictii_antihalucinatie": "Nu folosi Jest pe backend. Nu introduce dependențe de servicii externe în CI."
    },
    {
        "id_task": "F7.3.2",
        "denumire_task": "Build/push imagini (main) cu tagging imutabil + pin digest",
        "descriere_task": "Automatizează build + push + update commit în gitops repo (ou environment file). Deploy-ul trebuie să fie atomic (folosește digest în compose file, nu tag mutabil). Include rollback strategy.",
        "cale_implementare": ".github/workflows/release.yml + Infra/ops/release/",
        "contextul_anterior": "F7.2 produce imagini; F7.3 le publică și le consumă deterministic.",
        "validare_task": "Deploy folosește digest, nu tag mutabil; reproducerea build-ului produce același artefact (în limite rezonabile).",
        "outcome_task": "Release-uri reproductibile.",
        "restrictii_antihalucinatie": "Nu face deploy pe 'latest'. Nu face push fără scanări + semnare."
    },
    {
        "id_task": "F7.3.3",
        "denumire_task": "CD staging automat + smoke tests post-deploy",
        "descriere_task": "Deploy automat în staging pe release; rulează migrații controlate (dacă e cazul) și smoke tests (health + flux minim).",
        "cale_implementare": ".github/workflows/deploy-staging.yml + Infra/ops/compose/staging/",
        "contextul_anterior": "Planul cere gating staging înainte de prod.",
        "validare_task": "Staging deploy reușit; smoke tests verzi; observabilitatea vede noul service.version.",
        "outcome_task": "Validare practică înainte de prod.",
        "restrictii_antihalucinatie": "Nu sări peste staging. Nu rula migrații fără lock/gating."
    },
    {
        "id_task": "F7.3.4",
        "denumire_task": "CD prod cu aprobare manuală + promovare digest (staging→prod)",
        "descriere_task": "Promovează exact același digest din staging în prod (fără rebuild). Include approvals și protecții de environment. Include verificări post-deploy și mecanism de rollback (rollback la digest anterior).",
        "cale_implementare": "packages/config (OpenTelemetry SDK) + Infra/ops/observability/",
        "contextul_anterior": "Industry standard: promote, don’t rebuild.",
        "validare_task": "Prod deploy folosește digest promovat; rollback testat pe un incident simulat.",
        "outcome_task": "Pipeline complet până la producție, sigur.",
        "restrictii_antihalucinatie": "Nu face deploy direct pe prod fără aprobare și fără staging."
    },
    {
        "id_task": "F7.3.5",
        "denumire_task": "Migrații DB zero-downtime (expand/contract) + advisory lock + timeouts",
        "descriere_task": "Definește politica de migrații: expand/contract, forward-only, fără schimbări destructive în același deploy. Rulează migrațiile ca job separat (cu advisory lock) și timeouts; include verificare schema drift.",
        "cale_implementare": "packages/database/ + Infra/ops/migrations/ (migration job) + Docs/runbooks/db-migrations.md",
        "contextul_anterior": "F2 a stabilit drizzle-kit/migrații; F7 trebuie să le ruleze corect în prod.",
        "validare_task": "Migrația concurentă este blocată; un deploy rolling nu cade din cauza schema mismatch; rollback app e posibil dacă migrația e doar additive.",
        "outcome_task": "Migrații sigure pentru producție.",
        "restrictii_antihalucinatie": "Nu rula migrații fără lock. Nu face breaking changes fără fazare (expand/contract)."
    },
    {
        "id_task": "F7.3.6",
        "denumire_task": "Auth pentru CI către bare metal (SSH keys / Agent) fără credențiale long-lived expuse",
        "descriere_task": "Configurează autentificarea CI către serverele bare metal folosind chei SSH dedicate (cu restricții de comandă) sau un Runner self-hosted izolat. Elimină chei statice din GitHub Secrets unde e posibil prin folosirea de environment-specific agents.",
        "cale_implementare": "Infra/ops/security/ + .github/workflows/*",
        "contextul_anterior": "Docs cer disciplină de secrete; accesul CI la prod trebuie să fie restrictiv și auditabil.",
        "validare_task": "Pipeline deploy rulează securizat; accesul este logat pe server; cheile SSH sunt rotabile.",
        "outcome_task": "Supply chain + acces securizat la producție.",
        "restrictii_antihalucinatie": "Nu folosi password auth. Nu păstra chei SSH private necriptate."
    }
    ]
    ```

### F7.4: Data safety & Disaster Recovery (backup/restore drills, plan de incident)

    ```JSON
    [
    {
        "id_task": "F7.4.1",
        "denumire_task": "Backups PostgreSQL (PITR) + restore drill (RPO/RTO)",
        "descriere_task": "Configurează backup-uri automate + PITR, retenție, encryption, și rulează un restore drill documentat. Definește RPO/RTO și verifică practic că sunt atinse.",
        "cale_implementare": "Infra/ops/db/backup + Docs/runbooks/backup-restore.md",
        "contextul_anterior": "F2/F5/F6 fac DB critic; fără DR nu e enterprise.",
        "validare_task": "Restore drill reușit; RPO/RTO documentate; acces la backup auditabil.",
        "outcome_task": "Rezistență la incidente de date.",
        "restrictii_antihalucinatie": "Nu declara DR fără test practic. Nu păstra backup-uri necriptate."
    },
    {
        "id_task": "F7.4.2",
        "denumire_task": "Strategie Redis durabilitate + impact BullMQ (failover/playbook)",
        "descriere_task": "Definește ce se întâmplă la failover Redis (cozi, job states, rate limiting). Configurează persistență conform necesităților și scrie playbook de recovery pentru BullMQ (stalled jobs, requeue).",
        "cale_implementare": "Infra/ops/redis + Docs/runbooks/queue-recovery.md",
        "contextul_anterior": "F4 depinde de BullMQ; Redis downtime are impact direct.",
        "validare_task": "Game day: simulează restart/failover; workerii se recuperează; nu există pierdere necontrolată de job-uri.",
        "outcome_task": "Procesare asincronă robustă în prod.",
        "restrictii_antihalucinatie": "Nu presupune că Redis e perfect durabil. Nu requeue masiv fără gating."
    },
    {
        "id_task": "F7.4.3",
        "denumire_task": "Kill-switch operare: Bulk/AI/Webhooks (degradare controlată)",
        "descriere_task": "Definește proceduri și config pentru oprirea pipeline-urilor grele (bulk/AI) și menținerea serviciilor critice (auth/UI). Include mod de \"degraded service\" și verifică că nu corupe datele.",
        "cale_implementare": "packages/config + Docs/runbooks/kill-switch.md",
        "contextul_anterior": "F5/F6 sunt intensive; în incident trebuie oprit controlat.",
        "validare_task": "Exercițiu: oprești bulk fără să afectezi login; revii fără inconsistent data.",
        "outcome_task": "Control operațional real.",
        "restrictii_antihalucinatie": "Nu opri prin \"kill -9\" ca procedură standard. Nu porni backfill fără fereastră operațională."
    },
    {
        "id_task": "F7.4.4",
        "denumire_task": "Backup Scripts Automation (pg_dump + WAL archiving)",
        "descriere_task": "**CONFORM Audit 2025-12-26:** Implementează scripturi automatizate pentru backup PostgreSQL:\n\n**Scripturi necesare:**\n1. `/opt/scripts/pg_backup.sh` - Daily base backup cu pg_basebackup\n2. `/opt/scripts/archive_wal.sh` - WAL archiving pentru PITR\n3. `/opt/scripts/redis_backup.sh` - Hourly Redis RDB snapshot\n\n**Cron jobs:**\n```bash\n# Daily full backup at 2 AM\n0 2 * * * /opt/scripts/pg_backup.sh\n# Hourly Redis snapshot\n0 * * * * /opt/scripts/redis_backup.sh\n```\n\n**Configurare PostgreSQL:**\n```\narchive_mode = on\narchive_command = 'gzip < %p > /backup/wal/%f.gz'\n```\n\n**Documentație:** Vezi Docs/runbooks/DR_Runbook.md pentru detalii complete.",
        "cale_implementare": "/opt/scripts/pg_backup.sh, redis_backup.sh + cron config",
        "contextul_anterior": "F7.4.1 menționează PITR dar fără scripturi concrete.",
        "validare_task": "1. Backup-urile rulează conform cron\n2. Verificare integritate cu pg_verifybackup\n3. Retenție 7 zile funcțională",
        "outcome_task": "Backup-uri automate și verificabile pentru producție.",
        "restrictii_antihalucinatie": "NU stoca backup-uri necriptate. NU omite verificarea automată."
    },
    {
        "id_task": "F7.4.5",
        "denumire_task": "DR Drill Documentation și Procedură",
        "descriere_task": "**CONFORM Audit 2025-12-26:** Creează documentația și procedura pentru DR drills trimestriale:\n\n**Fișier creat:** Docs/runbooks/DR_Runbook.md\n\n**Conținut:**\n- PITR restore steps cu exemple SQL\n- Redis recovery procedure\n- Full system recovery checklist\n- RPO/RTO targets și măsurare\n- Quarterly drill checklist\n\n**Drill procedure:**\n1. Schedule 4h maintenance window\n2. Fresh pg_dump before drill\n3. Simulate failure (stop PostgreSQL)\n4. Execute recovery steps\n5. Measure RTO/RPO actual\n6. Document lessons learned",
        "cale_implementare": "Docs/runbooks/DR_Runbook.md",
        "contextul_anterior": "F7.4.1-F7.4.4 definesc backup-uri dar fără procedură de test.",
        "validare_task": "DR drill executat și documentat. RTO/RPO confirmate.",
        "outcome_task": "Disaster recovery verificat practic, nu doar teoretic.",
        "restrictii_antihalucinatie": "NU declara DR ready fără cel puțin un drill reușit."
    }
    ]
    ```

### F7.5: Production readiness (SRE: autoscaling, resurse, runbooks, on-call)

    ```JSON
    [
    {
        "id_task": "F7.5.1",
        "denumire_task": "Resurse runtime: systemd slice config, process limits, graceful shutdown",
        "descriere_task": "Setează limitele de resurse via systemd/Docker (--cpus, --memory), timeout-uri, și graceful shutdown pentru a preveni pierderi de job-uri. Confirmă că workerii finalizează job-urile sau requeue corect la shutdown.",
        "cale_implementare": "Infra/ops/compose/ + apps/backend-worker/src/",
        "contextul_anterior": "F4/F5 worker processing trebuie să fie sigur la scale/rollout.",
        "validare_task": "Rolling update nu pierde job-uri; SIGTERM este gestionat corect; systemd restart on failure funcționează.",
        "outcome_task": "Stabilitate la deploy și scale.",
        "restrictii_antihalucinatie": "Nu seta limits arbitrar. Nu ignora semnalele de shutdown."
    },
    {
        "id_task": "F7.5.2",
        "denumire_task": "Manual Horizontal Scaling (scale worker=N) + capacity review",
        "descriere_task": "Documentează procedura de scalare orizontală manuală (docker compose up -d --scale worker=15) bazată pe monitorizarea queue depth. Setează alerte care sugerează scalarea (ex: lag > 1h). Autoscaling automat pe bare metal e complex și riscant inițial; preferăm scalare manuală controlată.",
        "cale_implementare": "packages/logger + Infra/ops/metrics/",
        "contextul_anterior": "F4.2 fairness și F4.3 rate limiting există; scaling trebuie să le respecte.",
        "validare_task": "Load test: creștem manual workerii și observăm creșterea throughput-ului; DB/Redis rămân stabile.",
        "outcome_task": "Scalare controlată, multi-tenant safe.",
        "restrictii_antihalucinatie": "Nu scala doar pe CPU fără semnale de backlog. Nu crește concurența fără a verifica cost-based limiting."
    },
    {
        "id_task": "F7.5.3",
        "denumire_task": "Runbooks + incident response + postmortem template",
        "descriere_task": "Scrie runbooks pentru: deploy, rollback, migrații, Redis incident, Postgres incident, 429 storm, bulk stuck, AI backlog. Definește proces postmortem (blameless) și escaladare.",
        "cale_implementare": "Docs/runbooks/",
        "contextul_anterior": "Docs cer disciplină operațională; F7 finalizează producția.",
        "validare_task": "Game day executat după runbook; echipa poate urma pașii fără autorul inițial.",
        "outcome_task": "Operații enterprise, predictibile.",
        "restrictii_antihalucinatie": "Nu lăsa runbook-uri ne-testate. Nu include secrete în runbooks."
    },
    {
        "id_task": "F7.5.4",
        "denumire_task": "SRE Review: Simulare pipeline cu 10K mock SKU",
        "descriere_task": "**CONFORM AUDIT 2025-12-26:** Validare fezabilitate prin simulare practică:\n\n**Obiectiv:** Rulează full pipeline simulation cu 10.000 produse mock pentru validare performanță și identificare bottlenecks.\n\n**Scenarii de test:**\n1. **Bulk Ingest:** 10K products JSONL → streaming → DB în < 5 minute\n2. **Webhook Storm:** 1000 webhooks/min pentru același shop → queue handling OK\n3. **Rate Limiting:** Simulează 429 responses → backoff funcționează\n4. **Multi-tenant Fairness:** 3 shops cu volume diferite → niciun shop blocat\n5. **Memory Profile:** Worker memory stable (no leaks) pe parcursul testului\n\n**Tooling:**\n- k6 pentru load testing HTTP\n- Custom script pentru mock Shopify Bulk Operation response\n- Prometheus/Grafana pentru metrics collection\n\n**Metrici target:**\n| Metric | Target | Alert Threshold |\n|--------|--------|-----------------|\n| Ingest rate | >50 products/sec | <30 products/sec |\n| Webhook latency p99 | <200ms | >500ms |\n| Queue backlog | <1000 jobs | >5000 jobs |\n| Worker memory | <512MB | >800MB |\n\n**Output:** Raport de performanță documentat în Docs/SRE_Performance_Report.md",
        "cale_implementare": "tests/load/ + Docs/SRE_Performance_Report.md",
        "contextul_anterior": "F7.5.1-F7.5.3 definesc infrastructure. SRE review validează că totul funcționează la scale.",
        "validare_task": "1. Test 10K SKU finalizat fără erori\n2. Toate metricile în target\n3. Raport de performanță generat",
        "outcome_task": "Validation practică: sistemul funcționează pentru 1M+ SKU (extrapolat de la 10K test).",
        "restrictii_antihalucinatie": "NU declara production-ready fără acest test. NU extrapola fără date reale."
    }
    ]
    ```

### F7.6: Cross-Cutting Concerns (Frontend Quality)

    ```JSON
    [
    {
        "id_task": "F7.6.1",
        "denumire_task": "Accessibility Audit + Remediation",
        "descriere_task": "Rulare axe-core sau Lighthouse accessibility audit. Fix: focus management, ARIA labels pe toate interactive elements, keyboard navigation completă, color contrast WCAG 2.1 AA. Documentare checklist per pagină.",
        "cale_implementare": "Toate paginile + /apps/web-admin/docs/accessibility-checklist.md",
        "contextul_anterior": "UI-ul este funcțional dar netestat pentru a11y.",
        "validare_task": "Lighthouse a11y score >= 90. axe-core 0 critical issues.",
        "outcome_task": "Aplicație accesibilă conform standardelor enterprise.",
        "restrictii_antihalucinatie": "NU ignorați warnings - fiecare trebuie fix sau documented exception.",
        "prioritate": "P2"
    },
    {
        "id_task": "F7.6.2",
        "denumire_task": "Performance Audit (bundle size, lazy loading)",
        "descriere_task": "Analyze bundle cu vite-bundle-visualizer. Implement React.lazy() pentru toate routes. Code splitting per feature. Target: <200KB initial JS (gzipped).",
        "cale_implementare": "/apps/web-admin/vite.config.ts + route lazy loading",
        "contextul_anterior": "Aplicația funcționează dar bundle size neverificat.",
        "validare_task": "Build report arată <200KB initial. Routes încărcate lazy confirmate în network tab.",
        "outcome_task": "Performance optimă pentru load time.",
        "restrictii_antihalucinatie": "NU lazy-load critical path (app shell). Target e 200KB gzipped, not raw.",
        "prioritate": "P2"
    },
    {
        "id_task": "F7.6.3",
        "denumire_task": "E2E Tests cu Playwright (critical paths)",
        "descriere_task": "Setup Playwright pentru apps/web-admin. Teste pentru: login flow, start ingestion, search product, view queue details, change settings. Run în CI pe PR. Minim 5 teste critice.",
        "cale_implementare": "/apps/web-admin/e2e/*.spec.ts + playwright.config.ts + CI workflow update",
        "contextul_anterior": "Unit tests cu Vitest există. E2E testing lipsește.",
        "validare_task": "pnpm playwright test passes. CI workflow includes E2E step.",
        "outcome_task": "Critical paths validated end-to-end automat.",
        "restrictii_antihalucinatie": "NU dependeți de testarea manuală pentru critical paths.",
        "prioritate": "P2"
    },
    {
        "id_task": "F7.6.4",
        "denumire_task": "Mobile Responsiveness Pass",
        "descriere_task": "Test toate paginile pe viewport 375px (iPhone SE). Fix layout breaks, touch targets ≥44px, scrollable tables cu horizontal scroll, collapsible sidebar. Document breakpoints.",
        "cale_implementare": "Toate paginile + tailwind.config.ts (breakpoints)",
        "contextul_anterior": "Design e desktop-first. Mobile netestat.",
        "validare_task": "Toate paginile funcționează pe 375px viewport fără horizontal overflow.",
        "outcome_task": "Aplicație utilizabilă pe mobile pentru on-the-go access.",
        "restrictii_antihalucinatie": "NU ascundeți funcționalitate pe mobile - adaptați, nu eliminați.",
        "prioritate": "P2"
    },
    {
        "id_task": "F7.6.5",
        "denumire_task": "Dark Mode Support",
        "descriere_task": "Tailwind dark: variants pe toate componentele. Toggle în header. Persist preference în localStorage. Respect system preference (prefers-color-scheme).",
        "cale_implementare": "/apps/web-admin/app/root.tsx (theme provider) + componente",
        "contextul_anterior": "Design system folosește Tailwind. Dark mode neimplementat.",
        "validare_task": "Toggle funcționează. Preferința persistă. System preference respectată.",
        "outcome_task": "Dark mode pentru reduced eye strain.",
        "restrictii_antihalucinatie": "NU uitați charts și imagini - trebuie și ele adaptate.",
        "prioritate": "P3"
    },
    {
        "id_task": "F7.6.6",
        "denumire_task": "Keyboard Shortcuts (power users)",
        "descriere_task": "Global shortcuts: Ctrl+K search, Ctrl+/ help modal, G+D go to dashboard, G+Q go to queues, G+P go to products. Display shortcuts în help modal.",
        "cale_implementare": "/apps/web-admin/app/hooks/use-keyboard-shortcuts.ts + /apps/web-admin/app/components/domain/HelpModal.tsx",
        "contextul_anterior": "Navigarea e mouse-based. Power users beneficiază de shortcuts.",
        "validare_task": "Toate shortcut-urile funcționează. Help modal le listează.",
        "outcome_task": "Power user experience îmbunătățită.",
        "restrictii_antihalucinatie": "NU suprascrieți browser shortcuts (Ctrl+T, Ctrl+W etc.).",
        "prioritate": "P3"
    },
    {
        "id_task": "F7.6.7",
        "denumire_task": "Internationalization Setup (i18n)",
        "descriere_task": "Setup react-i18next pentru suport multi-limbă:\n\n**Configurare:**\n- i18next-browser-languagedetector pentru auto-detect\n- react-i18next Provider în root.tsx\n- defaultNS: 'common', fallbackLng: 'en'\n\n**Namespace-uri:**\n- common.json (butoane, labels generice)\n- errors.json (mesaje de eroare)\n- forms.json (validări, placeholders)\n- pages.json (titluri pagini, descrieri)\n\n**Structură fișiere:**\n/apps/web-admin/public/locales/en/*.json\n/apps/web-admin/public/locales/ro/*.json\n\n**Integrare:**\n- Hook useTranslation() în toate componentele text\n- Language selector în Settings page\n- Persist preference în localStorage",
        "cale_implementare": "/apps/web-admin/app/i18n.ts, /apps/web-admin/public/locales/, /apps/web-admin/app/routes/app.settings.tsx",
        "contextul_anterior": "Aplicația funcționează doar în engleză. Adăugăm infrastructură pentru localizare.",
        "validare_task": "Schimbă limba în Settings și verifică că textele se traduc corect. No hardcoded strings în componente UI.",
        "outcome_task": "Aplicație pregătită pentru localizare EN/RO.",
        "restrictii_antihalucinatie": "NU traduceți TOATE textele dintr-o dată - setup + 1-2 pagini demo, restul progresiv. Folosiți namespace separation.",
        "prioritate": "P2"
    },
    {
        "id_task": "F7.6.8",
        "denumire_task": "Accessibility Checklist per Page",
        "descriere_task": "Creare checklist a11y per pagină în apps/web-admin/docs/a11y-checklists/:\n\n**Template (WCAG 2.1 AA):**\n- [ ] Interactive elements au focus visible\n- [ ] Color contrast >= 4.5:1\n- [ ] Images au alt text\n- [ ] Form fields au labels\n- [ ] Keyboard navigation funcționează\n- [ ] Error messages cu role='alert'\n\n**Fișiere:** dashboard.a11y.md, products.a11y.md, queues.a11y.md, ingestion.a11y.md, search.a11y.md, settings.a11y.md",
        "cale_implementare": "/apps/web-admin/docs/a11y-checklists/*.md",
        "contextul_anterior": "F7.6.1 menționează 'Documentare checklist per pagină'.",
        "validare_task": "6 fișiere .md create cu checklist completat.",
        "outcome_task": "Accessibility checklists per page pentru review.",
        "restrictii_antihalucinatie": "Checklist-ul este MANUAL review, nu doar automated tools.",
        "prioritate": "P2"
    },
    {
        "id_task": "F7.6.9",
        "denumire_task": "Definition of Done Template",
        "descriere_task": "Creare DoD pentru frontend tasks:\n\n**DoD (apps/web-admin/docs/DEFINITION_OF_DONE.md):**\n1. Code Complete: TypeScript strict, ESLint clean\n2. Tested: Unit tests Vitest, coverage >80%\n3. Accessible: Checklist a11y (F7.6.8)\n4. Reviewed: Code review aprobat\n5. Documented: JSDoc, Component specs (F3.5.13)\n\n**Integrare:** Adaugă în .github/PULL_REQUEST_TEMPLATE.md",
        "cale_implementare": "/apps/web-admin/docs/DEFINITION_OF_DONE.md, /.github/PULL_REQUEST_TEMPLATE.md",
        "contextul_anterior": "Metrici de succes cer teste în DoD.",
        "validare_task": "DEFINITION_OF_DONE.md creat, PR template cu DoD checklist.",
        "outcome_task": "Standard clar pentru 'done' pe frontend tasks.",
        "restrictii_antihalucinatie": "DoD este CHECKLIST, nu document lung.",
        "prioritate": "P1"
    }
    ]
    ```

### F7.7: Observability UI (Frontend pentru Debugging)

    ```JSON
    [
    {
        "id_task": "F7.7.1",
        "denumire_task": "Health Dashboard (system status page)",
        "descriere_task": "Pagină /app/health. Status cards pentru: API (Fastify), Redis, Postgres, Shopify API (rate limit status), Workers (active count). Green/Yellow/Red indicators. Auto-refresh la 30s.",
        "cale_implementare": "/apps/web-admin/app/routes/app.health.tsx + /apps/web-admin/app/components/domain/HealthStatusCard.tsx",
        "contextul_anterior": "Backend health endpoints din F7.1. OTel metrics există.",
        "validare_task": "Toate cardurile afișează status real. Color coding corect. Auto-refresh funcționează.",
        "outcome_task": "Vizibilitate instant asupra system health.",
        "restrictii_antihalucinatie": "NU expuneți internal IPs sau connection strings.",
        "prioritate": "P2"
    },
    {
        "id_task": "F7.7.2",
        "denumire_task": "Metrics Visualization (din OTel)",
        "descriere_task": "Grafice pentru: request latency (p50, p95, p99), queue throughput (jobs/min), error rates (4xx, 5xx), memory usage. Time range selector (1h, 6h, 24h, 7d). Folosiți chart library (Recharts sau similar).",
        "cale_implementare": "/apps/web-admin/app/routes/app.metrics.tsx + /apps/web-admin/app/components/domain/MetricsCharts.tsx",
        "contextul_anterior": "OTel collector din F7.1 exportă metrici.",
        "validare_task": "Charts randează date reale. Time range change updates data.",
        "outcome_task": "Insights operaționale fără acces la Grafana.",
        "restrictii_antihalucinatie": "NU încercați să recreați Grafana - doar high-level overview.",
        "prioritate": "P3"
    },
    {
        "id_task": "F7.7.3",
        "denumire_task": "Trace Viewer (link to Jaeger/Tempo)",
        "descriere_task": "Pentru fiecare operație failed, link direct către trace-ul în Jaeger. Format: /trace/{traceId}. Sau embed iframe dacă Jaeger permite. Minimum: copy-able trace ID.",
        "cale_implementare": "/apps/web-admin/app/components/domain/TraceLink.tsx",
        "contextul_anterior": "Jaeger rulează din F1.2.4. Trace IDs în logs.",
        "validare_task": "Link-ul deschide trace-ul corect în Jaeger. TraceId copiabil.",
        "outcome_task": "Debugging rapid pentru operații failed.",
        "restrictii_antihalucinatie": "Jaeger URL configurabil (nu hardcodat localhost).",
        "prioritate": "P3"
    },
    {
        "id_task": "F7.7.4",
        "denumire_task": "Audit Log UI",
        "descriere_task": "Pagină cu toate acțiunile user-ului: logins, syncs started, settings changed, exports downloaded. Filterable by date range, action type, user. Paginare pentru volume mari.",
        "cale_implementare": "/apps/web-admin/app/routes/app.audit.tsx + /apps/web-admin/app/components/domain/AuditLogTable.tsx",
        "contextul_anterior": "Audit logs persistate în DB din F2.",
        "validare_task": "Log entries afișate corect. Filters funcționează. Paginare pentru >100 entries.",
        "outcome_task": "Compliance și debugging pentru acțiuni utilizator.",
        "restrictii_antihalucinatie": "NU expuneți date sensibile (tokens, passwords). Afișați doar action metadata.",
        "prioritate": "P3"
    }
    ]
    ```

### F7.8: Frontend Hooks Library (Audit Frontend - Săptămâna 8)

> **Origine:** Audit Frontend 2025-12-26 - Doar 2 hooks documentate din 16+ necesare
> **Dependențe:** F3.5 (Foundation), F3.8 (Data Fetching Patterns)

    ```JSON
    [
    {
        "id_task": "F7.8.1",
        "denumire_task": "Data Fetching Hooks",
        "descriere_task": "Custom hooks pentru data fetching cu React Router loaders:\n\n**useProducts(options):** Fetch products cu filters, paginare, search. Returns {products, isLoading, error, page, totalPages, refetch}.\n\n**useProduct(id):** Fetch single product cu variants și metafields.\n\n**useJobs(queueName):** Fetch queue jobs cu status filter.\n\n**useMetrics(endpoint):** Fetch metrics data pentru charts.\n\nToate hooks folosesc React Router loaders/actions pattern.",
        "cale_implementare": "/apps/web-admin/app/hooks/useProducts.ts, useProduct.ts, useJobs.ts, useMetrics.ts",
        "contextul_anterior": "F3.8 definește data fetching patterns. Lips hooks concrete.",
        "validare_task": "useProducts returnează datele corect cu loading state.",
        "outcome_task": "Data fetching standardizat în toată aplicația.",
        "restrictii_antihalucinatie": "Folosiți React Router loaders, NU TanStack Query ca default.",
        "prioritate": "P1"
    },
    {
        "id_task": "F7.8.2",
        "denumire_task": "Real-time Hooks",
        "descriere_task": "Hooks pentru actualizări real-time:\n\n**useLiveQueue(queueName):** WebSocket connection pentru queue status updates. Auto-reconnect on disconnect.\n\n**useLiveMetrics(endpoint):** Polling pentru metrics la interval configurable.\n\n**useLiveSync(shopId):** WebSocket pentru sync progress notifications.\n\nToate hooks au cleanup pe unmount și error handling.",
        "cale_implementare": "/apps/web-admin/app/hooks/useLiveQueue.ts, useLiveMetrics.ts, useLiveSync.ts",
        "contextul_anterior": "useJobPolling există (F3.5), dar lipsesc alte real-time hooks.",
        "validare_task": "WebSocket connection stabilă. Updates primite în <100ms.",
        "outcome_task": "Real-time experience pentru monitoring.",
        "restrictii_antihalucinatie": "WebSocket > SSE pentru unidirectional updates.",
        "prioritate": "P1"
    },
    {
        "id_task": "F7.8.3",
        "denumire_task": "UI State Hooks",
        "descriere_task": "Hooks pentru UI state management:\n\n**useTableState(initialSort):** Sort, filter, pagination state for tables. Persists to URL params.\n\n**useBulkSelection(items):** Checkbox selection logic. Select all, select page, clear, isSelected.\n\n**useFormState(schema, initialValues):** Form state cu Zod validation.\n\n**useDialog():** Open/close state pentru modals. Returns {isOpen, open, close, toggle}.",
        "cale_implementare": "/apps/web-admin/app/hooks/useTableState.ts, useBulkSelection.ts, useFormState.ts, useDialog.ts",
        "contextul_anterior": "Nu există hooks UI state documentate.",
        "validare_task": "useTableState sync-ează cu URL. useBulkSelection select all works.",
        "outcome_task": "UI state logic reutilizabilă.",
        "restrictii_antihalucinatie": "NU folosiți global state (Redux/Zustand) pentru local UI state.",
        "prioritate": "P1"
    },
    {
        "id_task": "F7.8.4",
        "denumire_task": "Utility Hooks",
        "descriere_task": "Hooks utilitare:\n\n**useCopyToClipboard():** Copy text cu success feedback.\n\n**useLocalStorage(key, defaultValue):** Persist state în localStorage.\n\n**useDarkMode():** Toggle dark/light mode.\n\n**useDebounce(value, delay):** Debounced value pentru search inputs.\n\n**useMediaQuery(query):** Responsive breakpoint detection.",
        "cale_implementare": "/apps/web-admin/app/hooks/useCopyToClipboard.ts, useLocalStorage.ts, useDarkMode.ts, useDebounce.ts, useMediaQuery.ts",
        "contextul_anterior": "F7.6.5 menționează dark mode dar fără hook.",
        "validare_task": "Toate utility hooks funcționează correct în isolation.",
        "outcome_task": "Utility functions ca reusable hooks.",
        "prioritate": "P2"
    },
    {
        "id_task": "F7.8.5",
        "denumire_task": "Keyboard Shortcuts Hook",
        "descriere_task": "Hook useKeyboardShortcuts pentru global shortcuts:\n\n**Props:**\n- shortcuts: Array<{key, ctrl?, alt?, shift?, handler}>\n- enabled?: boolean (disable temporar)\n- scope?: string (pentru nested contexts)\n\n**Default shortcuts:**\n- Ctrl+K: Open global search\n- Ctrl+/: Show shortcuts help\n- Escape: Close current modal\n- Ctrl+S: Save current form",
        "cale_implementare": "/apps/web-admin/app/hooks/useKeyboardShortcuts.ts",
        "contextul_anterior": "F7.6.6 menționează keyboard shortcuts, acest hook le implementează.",
        "validare_task": "Shortcuts funcționale. No conflicts cu browser defaults.",
        "outcome_task": "Keyboard navigation enterprise.",
        "restrictii_antihalucinatie": "Respectați keyboard accessibility - nu override vital browser shortcuts.",
        "prioritate": "P1"
    }
    ]
    ```

## Faza F8: Extensii Avansate (Opțional, Post-MVP)

Durată: Săptămâna 12+ (opțional, după producție)
Obiectiv: Extensii specifice care nu sunt strict necesare pentru MVP dar îmbunătățesc operațiunile la scară mare.

> [!IMPORTANT]
> **REDISTRIBUIRE CRONOLOGICĂ:** Componentele originale F8 au fost mutate în fazele corecte pentru a rezolva inversiunea cronologică. Vezi tabelul de mai jos pentru mappingul complet.

### Mapare Redistribuire F8

| Task Original                       | Destinație Nouă        | Motiv Redistribuire                         |
| ----------------------------------- | ---------------------- | ------------------------------------------- |
| F8.1.1 (shops, RLS)                 | **ELIMINAT**           | Duplicat cu F2.2.1 (schema inițială)        |
| F8.1.2 (shopify_products, Bulk Ops) | **ELIMINAT**           | Duplicat cu F2.2.1 + F5 (pipeline ingestie) |
| F8.1.3 (Inventory Ledger)           | **→ F8.1.1 (păstrat)** | OK ca extensie post-MVP                     |
| F8.2.1 (PIM 4-Layer)                | **→ F2.2.5**           | Schema PIM e PREREQUISITE pentru F5/F6      |
| F8.2.2 (Taxonomy Engine)            | **→ F2.2.6**           | Import taxonomy ÎNAINTE de validare în F5   |
| F8.3.1 (pgvector, deduplicare)      | **→ F2.2.7 + F5.2.9**  | Schema în F2, logica în F5 la ingestie      |
| F8.3.2 (Consensus Logic)            | **→ F5.2.10**          | Arbitrajul rulează LA ingestie, nu post     |
| Conflict pgvector↔Redis             | **→ F6.2.8**           | Sync strategy explicit definit              |

### F8.1: Extensii de Inventar (High-Velocity)

    ```JSON
    [
    {
        "id_task": "F8.1.1",
        "denumire_task": "Inventory Ledger (Append-Only High-Velocity) - EXTENSIE POST-MVP",
        "descriere_task": "**EXTENSIE OPȚIONALĂ** pentru write-heavy workloads de inventar.\n\nNECESAR DOAR CÂND: aveți >50 update-uri/sec pe același SKU sau experimentați locking contention.\n\n**Problema Rezolvată:**\n- UPDATE direct pe quantity → row lock → blocking\n- La 50+ update-uri/sec → deadlocks, timeout-uri\n\n**Soluția Ledger (Append-Only):**\n```sql\nCREATE TABLE inventory_ledger (\n  id uuid PRIMARY KEY DEFAULT uuidv7(),\n  shop_id uuid REFERENCES shops(id),\n  sku text NOT NULL,\n  location_id text,\n  delta int NOT NULL, -- +5 = restock, -1 = sold\n  reason text CHECK (reason IN ('sale', 'return', 'adjustment', 'restock', 'transfer')),\n  reference_id text, -- order_id, transfer_id, etc.\n  created_at timestamptz DEFAULT now()\n);\n\nALTER TABLE inventory_ledger ENABLE ROW LEVEL SECURITY;\nALTER TABLE inventory_ledger FORCE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation_inventory_ledger ON inventory_ledger\n  FOR ALL TO app_runtime\n  USING (shop_id = COALESCE(current_setting('app.current_shop_id', true)::uuid, '00000000-0000-0000-0000-000000000000'::uuid));\n\nCREATE INDEX idx_inventory_ledger_sku_location ON inventory_ledger(shop_id, sku, location_id);\nCREATE INDEX idx_inventory_ledger_created ON inventory_ledger(created_at);\n\n-- Materialized View pentru stoc curent (refresh async)\nCREATE MATERIALIZED VIEW inventory_current AS\nSELECT shop_id, sku, location_id, SUM(delta) as quantity\nFROM inventory_ledger\nGROUP BY shop_id, sku, location_id;\n\nCREATE UNIQUE INDEX idx_inventory_current_pk ON inventory_current(shop_id, sku, location_id);\n\n-- Refresh periodic (cron job sau pg_cron)\n-- REFRESH MATERIALIZED VIEW CONCURRENTLY inventory_current;\n```\n\n**Advisory Locks pentru prevenirea overselling:**\n```typescript\nasync function reserveInventory(shopId: string, sku: string, qty: number): Promise<boolean> {\n  return await db.transaction(async (tx) => {\n    // Lock pe SKU specific (atomic, nu blochează alte SKU-uri)\n    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${shopId}||':'||${sku}))`);\n    \n    // Citește stocul curent (din materialized view sau REFRESH pe loc)\n    const current = await tx.query(sql`\n      SELECT COALESCE(SUM(delta), 0) as quantity \n      FROM inventory_ledger \n      WHERE shop_id = ${shopId} AND sku = ${sku}\n    `);\n    \n    if (current.rows[0].quantity < qty) {\n      return false; // Insufficient inventory\n    }\n    \n    // Append delta negativ\n    await tx.insert(inventoryLedger).values({\n      shopId, sku, delta: -qty, reason: 'sale'\n    });\n    \n    return true;\n  });\n}\n```\n\n**Benchmark vs UPDATE direct:**\n| Metrica | UPDATE direct | Ledger Append |\n|---------|--------------|---------------|\n| 10 concurrent/SKU | OK | OK |\n| 50 concurrent/SKU | Timeouts | OK |\n| 100 concurrent/SKU | Deadlocks | OK |\n| Read latency | 1ms | 5ms (MV) sau 20ms (SUM) |",
        "cale_implementare": "/Neanelu_Shopify/packages/database/src/schema/inventory.ts + apps/backend-worker/src/services/inventory.ts",
        "contextul_anterior": "F2-F6 definesc flow-ul principal cu UPDATE direct pe quantity. Ledger e migrare pentru scale.",
        "validare_task": "100 update-uri concurente pe același SKU → zero deadlocks, stoc final corect. Comparative benchmark vs UPDATE direct.",
        "outcome_task": "Scalabilitate masivă pentru update-uri de stoc în contexte high-velocity.",
        "restrictii_antihalucinatie": "NU migra la Ledger fără benchmarking - UPDATE direct e OK pentru majoritatea cazurilor. NU uita să refresh-ui materialized view. Advisory lock e pe transaction, nu global."
    }
    ]
    ```

### F8.2: Extensii Future (Placeholder)

> [!NOTE]
> Această secțiune este rezervată pentru extensii viitoare care pot fi adăugate după ce sistemul este în producție și stabil. Exemple:
>
> - Multi-warehouse inventory allocation
> - AI-powered dynamic pricing
> - Advanced analytics și reporting
> - Integration cu alte channel-uri (Amazon, eBay, etc.)

### F8.3: Frontend Extensions (Post-MVP, Target Q1 2026)

> [!IMPORTANT]
> **CONFORM AUDIT 2025-12-26:** Această secțiune extinde UI-ul minimal din F3-F4 cu interfețe complete pentru admin.
>
> **Target Timeline:** Q1 2026 (după stabilizare backend în producție)

    ```JSON
    [
    {
        "id_task": "F8.3.1",
        "denumire_task": "Product Editor UI - Editare produse cu pre-populare Shopify",
        "descriere_task": "**Timeline: Q1 2026**\n\nImplementează interfață completă de editare produse:\n\n**Componente:**\n- ProductForm cu toate câmpurile din schema Shopify\n- MediaUploader pentru imagini (drag & drop)\n- VariantsTable cu inline editing\n- MetafieldsEditor pentru custom fields\n- PublishingControls (status, channels)\n\n**Flow:**\n1. Fetch produs existent de pe Shopify (pre-populare)\n2. Edit în UI local\n3. Save → validare → push la Shopify via GraphQL\n\n**Tech:**\n- React Hook Form pentru validare\n- Polaris components (Form, Select, TextField)\n- Optimistic updates cu rollback",
        "cale_implementare": "/apps/web-admin/app/routes/products.$id.edit",
        "contextul_anterior": "F3.5-F3.8 definesc shell-ul UI. F8.3 extinde cu funcționalitate completă.",
        "validare_task": "Poți edita un produs existent și vedea modificarea pe Shopify.",
        "outcome_task": "Admin poate gestiona produse direct din aplicație.",
        "restrictii_antihalucinatie": "NU implementa bulk edit în această iterație. Start simplu, extend progresiv."
    },
    {
        "id_task": "F8.3.2",
        "denumire_task": "AI Search Playground UI - Interfață căutare semantic",
        "descriere_task": "**Timeline: Q1 2026**\n\nImplementează interfață pentru căutare AI semantică:\n\n**Componente:**\n- SearchInput cu autocomplete\n- ResultsGrid cu thumbnail + similarity score\n- FiltersSidebar (categorie, brand, preț)\n- SimilarProductsPanel pentru deduplicare vizuală\n\n**Features:**\n- Natural language queries ('roșu pentru copii sub 100 lei')\n- Display similarity percentage pentru debugging\n- Compare mode pentru produse similare\n- Export results (CSV, JSON)\n\n**Integration:**\n- pgvector search din F6.4\n- OpenAI embeddings cache\n- Real-time results (<50ms)",
        "cale_implementare": "/apps/web-admin/app/routes/search.ai",
        "contextul_anterior": "F6.4 implementează backend AI search. Acesta e UI-ul companion.",
        "validare_task": "Căutare 'bluză albastră' returnează rezultate relevante cu score.",
        "outcome_task": "Utilizatorii pot căuta produse semantic, nu doar keyword match.",
        "restrictii_antihalucinatie": "NU suporta multi-modal search (imagini) în V1. Text only."
    },
    {
        "id_task": "F8.3.3",
        "denumire_task": "Settings & Configuration Pages - Gestiune configurări aplicație",
        "descriere_task": "**Timeline: Q1 2026**\n\nImplementează pagini de configurare pentru aplicație:\n\n**Pagini:**\n1. **API Settings** - Shopify API version, rate limits, refresh tokens\n2. **Queue Settings** - Worker concurrency, retry limits, priorities\n3. **AI Settings** - OpenAI model selection, embedding parameters\n4. **Notification Settings** - Slack webhooks, email alerts\n5. **User Management** - Roles (admin/viewer), permissions\n\n**Componente:**\n- SettingsLayout cu sidebar navigation\n- SettingsForm reusable pentru fiecare secțiune\n- SecretInput pentru sensitive fields (masked)\n- TestConnection buttons pentru validare\n\n**Persistare:**\n- settings_config table în DB\n- Environment override pentru producție",
        "cale_implementare": "/apps/web-admin/app/routes/settings._index + settings.$section",
        "contextul_anterior": "F3.5 definește layout. Settings necesită implementare post-MVP.",
        "validare_task": "Schimbarea worker concurrency se reflectă în comportamentul real.",
        "outcome_task": "Configurare aplicație fără acces la cod sau environment variables.",
        "restrictii_antihalucinatie": "NU permite schimbarea secrets din UI - doar view masked."
    },
    {
        "id_task": "F8.3.4",
        "denumire_task": "Dashboard Advanced - KPIs extinse și analytics",
        "descriere_task": "**Timeline: Q1 2026**\n\nExtinde dashboard-ul de bază cu metrici avansate:\n\n**Widgets noi:**\n- SyncProgress per shop (timeline)\n- ErrorHotspots (produse cu cele mai multe erori)\n- CostBreakdown (API calls per feature)\n- PerformanceTrends (graphs pe 7/30 zile)\n\n**Features:**\n- Date range picker global\n- Export dashboard ca PDF/PNG\n- Scheduled reports via email\n- Customizable layout (drag & drop widgets)\n\n**Data source:**\n- analytics_daily care agregă din event logs\n- Materialized views pentru performanță",
        "cale_implementare": "/apps/web-admin/app/routes/dashboard + analytics",
        "contextul_anterior": "F4.5 definește dashboard minimal. F8.3 extinde pentru operational insight.",
        "validare_task": "Dashboard arată metrics reale din ultimele 30 zile.",
        "outcome_task": "Vizibilitate completă în operațiunile aplicației.",
        "restrictii_antihalucinatie": "NU calcula analytics în real-time - folosește pre-agregat data."
    }
    ]
    ```

### F8.4: External Product Search Integration (Golden Record Strategy)

> [!IMPORTANT]
> **CONFORM AUDIT SCHEMA 2025-12-29:** Această secțiune implementează **Etapa 4** din strategia PIM pentru Golden Records:
>
> - Broad search/research de produse similare cu similaritate 95-100%
> - Colectare/scraping de informații și atribute din surse externe
> - Integrare cu Google APIs și xAI Grok pentru extracție structurată
>
> **Documentație completă:** `Docs/External_Product_APIs_Integration.md`

    ```JSON
    [
    {
        "id_task": "F8.4.1",
        "denumire_task": "Serper API Integration - Setup & GTIN Search",
        "descriere_task": "**Golden Record - Stage 4.1**\n\nImplementează integrare cu Serper API (înlocuiește Google Custom Search):\n\n**Configurare:**\n- Environment variables: SERPER_API_KEY\n- Rate limiting: 10 req/sec\n\n**Implementare:**\n```typescript\n// packages/pim/src/services/serper-search.ts\nexport async function searchProductByGTIN(gtin: string): Promise<ProductSearchResult[]>\nexport async function searchProductByMPN(brand: string, mpn: string): Promise<ProductSearchResult[]>\nexport async function searchProductByTitle(title: string, brand?: string): Promise<ProductSearchResult[]>\n```\n\n**Structured Data Parsing:**\n- Parse structured data din rezultatele Serper (organic + shopping)\n- Store results în prod_raw_harvest\n\n**Cost tracking:**\n- Log fiecare request în api_usage_log\n- Alertă când se apropie de buget zilnic",
        "cale_implementare": "/packages/pim/src/services/serper-search.ts + /packages/pim/src/schemas/serper-search.ts",
        "contextul_anterior": "F2.2.5-F2.2.7 definesc schema PIM. F6.1-F6.2 definesc AI/Vector.",
        "validare_task": "Search by GTIN returnează min. 3 rezultate relevante pentru un produs cunoscut. Structured data extrasă corect.",
        "outcome_task": "Căutare produse externe funcțională pentru enrichment.",
        "restrictii_antihalucinatie": "NU depăși bugetul zilnic. Cache results agresiv (24h TTL). NU căuta produse care au deja 3+ matches confirmed.",
        "prioritate": "P1"
    },
    {
        "id_task": "F8.4.2",
        "denumire_task": "prod_similarity_matches CRUD & Business Logic",
        "descriere_task": "**Golden Record - Stage 4.2**\n\nImplementează handlers pentru tabelul prod_similarity_matches:\n\n**Drizzle Schema:**\n```typescript\n// packages/database/src/schema/pim-similarity.ts\nexport const prodSimilarityMatches = pgTable('prod_similarity_matches', {\n  id: uuid('id').primaryKey().defaultRandom(),\n  productId: uuid('product_id').notNull().references(() => prodMaster.id),\n  sourceId: uuid('source_id').references(() => prodSources.id),\n  sourceUrl: text('source_url').notNull(),\n  sourceProductId: varchar('source_product_id', { length: 255 }),\n  sourceGtin: varchar('source_gtin', { length: 14 }),\n  sourceTitle: text('source_title'),\n  sourceBrand: varchar('source_brand', { length: 255 }),\n  sourcePrice: decimal('source_price', { precision: 12, scale: 2 }),\n  sourceCurrency: varchar('source_currency', { length: 3 }),\n  similarityScore: decimal('similarity_score', { precision: 5, scale: 4 }).notNull(),\n  matchMethod: varchar('match_method', { length: 30 }).notNull(),\n  matchConfidence: varchar('match_confidence', { length: 20 }).default('pending'),\n  matchDetails: jsonb('match_details').default({}),\n  extractionSessionId: uuid('extraction_session_id'),\n  specsExtracted: jsonb('specs_extracted'),\n  scrapedAt: timestamp('scraped_at', { withTimezone: true }),\n  validatedAt: timestamp('validated_at', { withTimezone: true }),\n  validatedBy: uuid('validated_by'),\n  validationNotes: text('validation_notes'),\n  isPrimarySource: boolean('is_primary_source').default(false),\n  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),\n  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),\n});\n```\n\n**Business Logic:**\n- Automatic duplicate detection by source_url\n- Similarity score validation (>= 0.95)\n- Match confidence workflow: pending → confirmed/rejected\n- Primary source selection logic",
        "cale_implementare": "/packages/database/src/schema/pim-similarity.ts + /packages/pim/src/repositories/similarity-matches.ts",
        "contextul_anterior": "Database schema v2.6 definește prod_similarity_matches.",
        "validare_task": "CRUD operations funcționale. Duplicate prevention by URL. Confidence transitions validate.",
        "outcome_task": "Persistare și gestiune matches din căutări externe.",
        "restrictii_antihalucinatie": "NU accepta similarity_score < 0.90. NU permite multiple primary sources per product.",
        "prioritate": "P1"
    },
    {
        "id_task": "F8.4.3",
        "denumire_task": "xAI Grok Structured Data Extractor",
        "descriere_task": "**Golden Record - Stage 4.3**\n\nImplementează extracție structurată cu xAI Grok API:\n\n**Configurare:**\n- Environment: XAI_API_KEY, XAI_BASE_URL\n- Model: grok-2-mini pentru bulk, grok-3 pentru validări\n- Temperature: 0.1 pentru consistență\n\n**Zod Schema pentru output:**\n```typescript\n// packages/pim/src/schemas/product-extraction.ts\nexport const ExtractedProductSchema = z.object({\n  title: z.string(),\n  brand: z.string().optional(),\n  mpn: z.string().optional(),\n  gtin: z.string().optional(),\n  category: z.string().optional(),\n  specifications: z.array(z.object({\n    name: z.string(),\n    value: z.string(),\n    unit: z.string().optional(),\n  })),\n  price: z.object({\n    amount: z.number().optional(),\n    currency: z.string().default('RON'),\n  }).optional(),\n  images: z.array(z.string().url()).default([]),\n  confidence: z.object({\n    overall: z.number().min(0).max(1),\n    fields_uncertain: z.array(z.string()).default([]),\n  }),\n});\n```\n\n**Anti-Hallucination:**\n- System prompt explicit: 'NU inventa valori'\n- Post-validation GTIN checksum\n- Confidence threshold: reject if < 0.8\n- Multi-source consensus before acceptance",
        "cale_implementare": "/packages/pim/src/services/xai-extractor.ts + /packages/pim/src/schemas/product-extraction.ts",
        "contextul_anterior": "F8.4.1 produce raw HTML. Acest task extrage structured data.",
        "validare_task": "Extracție din HTML real returnează specs valide. Confidence scores accurate. GTIN checksum pass.",
        "outcome_task": "Extracție automată de atribute din pagini web.",
        "restrictii_antihalucinatie": "REJECT results cu confidence < 0.8. VALIDATE GTIN cu checksum. NU trust brand/MPN fără 2+ surse concordante.",
        "prioritate": "P1"
    },
    {
        "id_task": "F8.4.4",
        "denumire_task": "BullMQ Enrichment Queue with Rate Limiting",
        "descriere_task": "**Golden Record - Stage 4.4**\n\nImplementează queue distribuită pentru enrichment cu rate limiting:\n\n**Queue Configuration:**\n```typescript\n// packages/pim/src/queues/enrichment-queue.ts\nconst enrichmentQueue = new Queue('pim-enrichment', {\n  connection: redis,\n  defaultJobOptions: {\n    attempts: 3,\n    backoff: { type: 'exponential', delay: 5000 },\n    removeOnComplete: { count: 1000 },\n  },\n});\n```\n\n**Rate Limiters per source:**\n- Google: 10 req/sec\n- xAI: 60 req/min\n- Generic scrapers: 5 req/sec\n\n**Job Types:**\n- `search-gtin`: Căutare produs by GTIN\n- `search-title`: Căutare produs by title+brand\n- `scrape-page`: Fetch & store HTML\n- `extract-specs`: xAI extraction\n- `validate-match`: Confirm/reject match\n\n**Priority System:**\n- P1: Golden candidates (high quality_score)\n- P2: Silver products (medium potential)\n- P3: Bronze products (low priority)",
        "cale_implementare": "/packages/pim/src/queues/enrichment-queue.ts + /packages/pim/src/workers/enrichment-worker.ts",
        "contextul_anterior": "F4.1 definește BullMQ foundation. Acest task specializează pentru PIM.",
        "validare_task": "Queue procesează jobs cu rate limiting corect. No 429 errors. Priorities respectate.",
        "outcome_task": "Procesare asincronă scalabilă pentru enrichment.",
        "restrictii_antihalucinatie": "NU bypass rate limits. NU procesează același produs de 2 ori în 24h. Respect concurrency limits.",
        "prioritate": "P1"
    },
    {
        "id_task": "F8.4.5",
        "denumire_task": "Multi-Source Consensus Engine",
        "descriere_task": "**Golden Record - Stage 5 (Compilation)**\n\nImplementează engine pentru compilare date din multiple surse:\n\n**Algoritm Consensus:**\n```typescript\n// packages/pim/src/services/consensus-engine.ts\nexport async function computeConsensus(productId: string): Promise<ConsensuResult> {\n  // 1. Fetch toate matches confirmed pentru produs\n  const matches = await getConfirmedMatches(productId);\n  \n  // 2. Group specs by attribute name\n  const attributeVotes = groupByAttribute(matches);\n  \n  // 3. Pentru fiecare atribut, calculează winner\n  const consensusSpecs = {};\n  for (const [attr, votes] of Object.entries(attributeVotes)) {\n    consensusSpecs[attr] = computeWinner(votes, {\n      weightByTrustScore: true,  // Source trust_score\n      weightBySimilarity: true,  // Match similarity_score\n      minVotes: 2,               // Min 2 surse pentru accept\n    });\n  }\n  \n  // 4. Compute overall quality score\n  const qualityScore = computeQualityScore(consensusSpecs, matches.length);\n  \n  return { specs: consensusSpecs, qualityScore, sourcesCount: matches.length };\n}\n```\n\n**Conflict Resolution:**\n- Majority voting pentru valori categorice\n- Weighted average pentru numerice\n- Trust score × similarity score = vote weight\n- Flag conflicts pentru manual review",
        "cale_implementare": "/packages/pim/src/services/consensus-engine.ts + /packages/pim/src/services/quality-scorer.ts",
        "contextul_anterior": "F8.4.1-F8.4.4 colectează date. Acest task le compilează.",
        "validare_task": "Consensus corect pentru 3+ surse. Quality score reflectă completeness. Conflicts flagged.",
        "outcome_task": "Compilare inteligentă a datelor din multiple surse.",
        "restrictii_antihalucinatie": "NU accept single-source pentru atribute critice (GTIN, brand). NU override manual corrections. Flag don't auto-resolve conflicts.",
        "prioritate": "P1"
    },
    {
        "id_task": "F8.4.6",
        "denumire_task": "Quality Level Promotion Logic (Bronze→Silver→Golden)",
        "descriere_task": "**Golden Record - Stage 6 (Promotion)**\n\nImplementează logica de promovare între quality levels:\n\n**Thresholds:**\n```typescript\n// packages/pim/src/services/quality-promoter.ts\nconst PROMOTION_THRESHOLDS = {\n  bronze_to_silver: {\n    minQualityScore: 0.6,\n    minSources: 2,\n    requiredFields: ['brand', 'category'],\n  },\n  silver_to_golden: {\n    minQualityScore: 0.85,\n    minSources: 3,\n    requiredFields: ['gtin', 'brand', 'mpn', 'category'],\n    minSpecsCount: 5,\n  },\n};\n```\n\n**Promotion Flow:**\n1. After consensus computation → check thresholds\n2. If eligible → update prod_master.data_quality_level\n3. Log event în prod_quality_events\n4. Trigger webhook if configured\n\n**Demotion Logic:**\n- If source rejected → recalculate consensus\n- If quality_score drops below threshold → demote\n- Log reason în prod_quality_events",
        "cale_implementare": "/packages/pim/src/services/quality-promoter.ts + /packages/pim/src/events/quality-events.ts",
        "contextul_anterior": "F8.4.5 produce consensus și quality score. Acest task promovează.",
        "validare_task": "Product cu 3 sources și score 0.9 → promoted to golden. Demotion când source rejected. Events logged.",
        "outcome_task": "Automatizare promovare produse către Golden Record status.",
        "restrictii_antihalucinatie": "NU promova fără minimum sources. NU demota fără recalculate. ALWAYS log events.",
        "prioritate": "P1"
    },
    {
        "id_task": "F8.4.7",
        "denumire_task": "API Cost Tracking & Budget Alerts",
        "descriere_task": "**Operațional - Cost Management**\n\nImplementează tracking pentru costuri API externe:\n\n**Tabel api_usage_log:**\n```sql\nCREATE TABLE api_usage_log (\n  id UUID PRIMARY KEY DEFAULT uuidv7(),\n  api_provider VARCHAR(50) NOT NULL,  -- google/xai/emag\n  endpoint VARCHAR(100) NOT NULL,\n  request_count INTEGER NOT NULL DEFAULT 1,\n  tokens_input INTEGER,\n  tokens_output INTEGER,\n  estimated_cost DECIMAL(10,4),\n  job_id VARCHAR(255),\n  product_id UUID REFERENCES prod_master(id),\n  created_at TIMESTAMPTZ DEFAULT now()\n);\n```\n\n**Budget Alerts:**\n- Daily budget per provider (configurable)\n- 80% warning alert\n- 100% hard stop (pause queue)\n- Weekly cost summary email\n\n**Dashboard Integration:**\n- Cost breakdown widget\n- Provider efficiency comparison\n- Cost per Golden Record metric",
        "cale_implementare": "/packages/database/src/schema/api-usage.ts + /packages/pim/src/services/cost-tracker.ts",
        "contextul_anterior": "F8.4.1-F8.4.6 consumă API-uri plătite. Acest task monitorizează costuri.",
        "validare_task": "Costuri logged corect. Alert la 80% budget. Queue paused la 100%. Dashboard shows breakdown.",
        "outcome_task": "Control financiar asupra consumului API.",
        "restrictii_antihalucinatie": "NU continuați procesare după budget exceeded. Alert before reaching limit. Include ALL API calls.",
        "prioritate": "P2"
    },
    {
        "id_task": "F8.4.8",
        "denumire_task": "PIM Progress Dashboard Materialized Views",
        "descriere_task": "**Analytics - PIM Metrics**\n\nImplementează MVs pentru dashboard PIM progress:\n\n**MVs definite în schema:**\n- mv_pim_quality_progress - distribuție bronze/silver/golden\n- mv_pim_enrichment_status - status enrichment per level\n- mv_pim_source_performance - performanță per source\n\n**Refresh Strategy:**\n```typescript\n// packages/pim/src/jobs/mv-refresh.ts\nexport const MV_REFRESH_SCHEDULE = {\n  'mv_pim_quality_progress': '0 * * * *',     // hourly\n  'mv_pim_enrichment_status': '0 * * * *',    // hourly\n  'mv_pim_source_performance': '0 0 * * *',   // daily\n};\n```\n\n**API Endpoints:**\n- GET /api/pim/stats/quality-distribution\n- GET /api/pim/stats/enrichment-progress\n- GET /api/pim/stats/source-performance",
        "cale_implementare": "/packages/pim/src/jobs/mv-refresh.ts + /apps/backend-api/src/routes/pim-stats.ts",
        "contextul_anterior": "Database schema v2.6 definește MVs. Acest task le activează.",
        "validare_task": "MVs refresh pe schedule. API returns accurate data. Dashboard displays correctly.",
        "outcome_task": "Vizibilitate în progresul PIM către Golden Records.",
        "restrictii_antihalucinatie": "Use CONCURRENTLY for refresh. Handle empty data gracefully. Cache API responses 1 min.",
        "prioritate": "P2"
    },
    {
        "id_task": "F8.4.9",
        "denumire_task": "Quality Events Webhook System",
        "descriere_task": "**Events - Notifications**\n\nImplementează sistem de webhooks pentru quality events:\n\n**Event Types:**\n- quality_promoted (bronze→silver, silver→golden)\n- quality_demoted (reverse)\n- review_requested (manual review needed)\n- milestone_reached (100/1000/10000 golden)\n\n**Webhook Payload:**\n```typescript\ninterface QualityEventPayload {\n  event_type: 'quality_promoted' | 'quality_demoted' | 'review_requested' | 'milestone_reached';\n  product_id: string;\n  sku: string;\n  previous_level?: string;\n  new_level: string;\n  quality_score: number;\n  trigger_reason: string;\n  timestamp: string;\n  shop_id?: string;\n}\n```\n\n**Delivery:**\n- Webhook URLs configurabile per shop\n- Retry logic: 3 attempts, exponential backoff\n- Signature verification (HMAC-SHA256)\n- Delivery status logging în prod_quality_events",
        "cale_implementare": "/packages/pim/src/services/webhook-dispatcher.ts + /packages/pim/src/events/quality-webhook.ts",
        "contextul_anterior": "F8.4.6 generează events. Acest task le transmite.",
        "validare_task": "Webhook sent on promotion. Retry pe failure. Signature validates. Delivery logged.",
        "outcome_task": "Notificări externe pentru schimbări de quality level.",
        "restrictii_antihalucinatie": "NU trimite webhooks pentru test data. Validate URL before save. Log all attempts.",
        "prioritate": "P2"
    },
    {
        "id_task": "F8.4.10",
        "denumire_task": "Web Scraper with Playwright (Fallback)",
        "descriere_task": "**Fallback - Generic Scraping**\n\nImplementează scraper generic pentru pagini fără Schema.org:\n\n**Stack:**\n- Playwright pentru rendering JS\n- Cheerio pentru parsing HTML static\n- robots.txt respect\n- Rate limiting per domain\n\n**Flow:**\n```typescript\n// packages/scraper/src/scrapers/generic.ts\nexport async function scrapeProductPage(url: string): Promise<RawHarvest> {\n  // 1. Check robots.txt\n  if (await isDisallowed(url)) throw new Error('Blocked by robots.txt');\n  \n  // 2. Render page with Playwright\n  const browser = await chromium.launch({ headless: true });\n  const page = await browser.newPage();\n  await page.goto(url, { waitUntil: 'networkidle' });\n  \n  // 3. Extract JSON-LD structured data\n  const jsonLd = await page.evaluate(() => {\n    const scripts = document.querySelectorAll('script[type=\"application/ld+json\"]');\n    return Array.from(scripts).map(s => JSON.parse(s.textContent || '{}'));\n  });\n  \n  const html = await page.content();\n  await browser.close();\n  \n  return { url, html, jsonLd, fetchedAt: new Date() };\n}\n```\n\n**Storage:**\n- HTML → prod_raw_harvest.raw_html\n- JSON-LD → prod_raw_harvest.raw_json\n- Content hash pentru deduplication",
        "cale_implementare": "/packages/scraper/src/scrapers/generic.ts + /packages/scraper/src/utils/robots-parser.ts",
        "contextul_anterior": "Google Search returnează URLs. Acest task fetch-uiește conținutul.",
        "validare_task": "Scrape page cu JS rendering. Extract JSON-LD. Respect robots.txt. Content hash dedup works.",
        "outcome_task": "Fallback pentru pagini care nu sunt în Google structured data.",
        "restrictii_antihalucinatie": "ALWAYS check robots.txt. NO scraping login-protected pages. Rate limit 1 req/sec per domain.",
        "prioritate": "P2"
    }
    ]
    ```

---

## Sprint Plan: Execuție și PR-uri

> [!IMPORTANT]
> Această secțiune definește planul de execuție pe **11 săptămâni** cu **76 PR-uri** granulare și branch-uri Git pentru implementarea completă a proiectului.

### Git Branch Strategy

| Branch Type | Pattern                         | Example                       | Description |
| ----------- | ------------------------------- | ----------------------------- | ----------- |
| Main        | `main`                          | Protected, requires PR review |             |
| Feature     | `feature/F{phase}-{short-desc}` | `feature/F1-monorepo-setup`   |             |
| PR Branch   | `pr/F{phase}.{task}-{desc}`     | `pr/F1.1-workspace-init`      |             |
| Hotfix      | `hotfix/{desc}`                 | `hotfix/oauth-callback`       |             |

---

### Sprint 1 (Săptămâna 1): Foundation & Monorepo Setup

#### F1.1: Workspace și Structură Monorepo

| PR #   | Branch                   | Tasks                                                                | Dependențe |
| ------ | ------------------------ | -------------------------------------------------------------------- | ---------- |
| PR-001 | `pr/F1.1-workspace-init` | F1.1.1-F1.1.5 (pnpm workspaces, tsconfig, packages)                  | -          |
| PR-002 | `pr/F1.2-docker-dev`     | F1.2.1-F1.2.5 (Docker Compose dev, Postgres 18.1, Redis 8.4, Jaeger) | PR-001     |

#### F1.3: Code Quality & Git Hooks

| PR #   | Branch                  | Tasks                                                | Dependențe |
| ------ | ----------------------- | ---------------------------------------------------- | ---------- |
| PR-003 | `pr/F1.3-quality-tools` | F1.3.1-F1.3.7 (Husky, lint-staged, ESLint, Prettier) | PR-001     |

#### F1.4: CI Skeleton

| PR #   | Branch                | Tasks                                               | Dependențe     |
| ------ | --------------------- | --------------------------------------------------- | -------------- |
| PR-004 | `pr/F1.4-ci-skeleton` | F1.4.1-F1.4.3 (ci-pr.yml, docker smoke, trivy scan) | PR-002, PR-003 |

**Sprint 1 Deliverables:**

- ✅ Monorepo funcțional cu pnpm workspaces
- ✅ Docker Compose pentru development
- ✅ Git hooks pentru calitate cod
- ✅ CI pipeline bazic pe PR

---

### Sprint 2 (Săptămâna 2): Data Layer & Schema Design

#### F2.1: ORM & Database Config

| PR #   | Branch                  | Tasks                                                    | Dependențe |
| ------ | ----------------------- | -------------------------------------------------------- | ---------- |
| PR-005 | `pr/F2.1-drizzle-setup` | F2.1.1-F2.1.2 (Drizzle ORM, pg driver, migrations setup) | PR-002     |

#### F2.2: Schema & RLS

| PR #   | Branch                         | Tasks                                                              | Dependențe |
| ------ | ------------------------------ | ------------------------------------------------------------------ | ---------- |
| PR-006 | `pr/F2.2-extensions`           | F2.1.2.1 (pgcrypto, citext, pg_trgm, pgvector)                     | PR-005     |
| PR-007 | `pr/F2.2-roles-bootstrap`      | F2.1.2.2 (single owner DB/tables)                                  | PR-006     |
| PR-008 | `pr/F2.2-core-schema`          | F2.2.1 (shops, products, tokens, bulk_runs - UUIDv7)               | PR-007     |
| PR-009 | `pr/F2.2-rls-policies`         | F2.2.2-F2.2.4 (RLS, SET LOCAL, integration tests)                  | PR-008     |
| PR-010 | `pr/F2.2-pim-schema`           | F2.2.5-F2.2.7 (prod_taxonomy, prod_core, pgvector embeddings)      | PR-009     |
| PR-011 | `pr/F2.2-oauth-webhook-tables` | F2.2.8-F2.2.17 (oauth_states, webhook_events, rate_limit, constr.) | PR-009     |

#### F2.3: Seed Data

| PR #   | Branch              | Tasks                              | Dependențe |
| ------ | ------------------- | ---------------------------------- | ---------- |
| PR-012 | `pr/F2.3-seed-data` | F2.3.1 (10K produse deterministic) | PR-010     |

**Sprint 2 Deliverables:**

- ✅ Schema completă PostgreSQL 18.1
- ✅ RLS pentru multi-tenancy
- ✅ Extensii (pgvector, pg_trgm)
- ✅ Seed data pentru development

---

### Sprint 3 (Săptămâna 3): Core Backend & Shopify Auth

#### F3.1: HTTP Server

| PR #   | Branch                   | Tasks                                               | Dependențe |
| ------ | ------------------------ | --------------------------------------------------- | ---------- |
| PR-013 | `pr/F3.1-fastify-server` | F3.1.1-F3.1.4 (Fastify, config, hardening, logging) | PR-009     |

#### F3.2: OAuth Implementation

| PR #   | Branch               | Tasks                                                  | Dependențe     |
| ------ | -------------------- | ------------------------------------------------------ | -------------- |
| PR-014 | `pr/F3.2-oauth-flow` | F3.2.1-F3.2.7 (OAuth routes, token storage, lifecycle) | PR-013, PR-011 |

#### F3.3: Webhooks Ingress

| PR #   | Branch             | Tasks                                            | Dependențe |
| ------ | ------------------ | ------------------------------------------------ | ---------- |
| PR-015 | `pr/F3.3-webhooks` | F3.3.1-F3.3.7 (HMAC, enqueue minim, deduplicare) | PR-014     |

#### F3.4: OTel Early

| PR # | Branch | Tasks | Dependențe |
| PR-016 | `pr/F3.4-otel-http` | F3.4.1-F3.4.5 (OpenTelemetry, spans, metrics) | PR-015 |

#### F3.5: Frontend Foundation

| PR #   | Branch               | Tasks                                                       | Dependențe |
| ------ | -------------------- | ----------------------------------------------------------- | ---------- |
| PR-017 | `pr/F3.5-vite-setup` | F3.5.0.1-F3.5.4 (Vite, Tailwind, Polaris, Dashboard)        | PR-001     |
| PR-018 | `pr/F3.5-app-shell`  | F3.5.5-F3.5.9 (Layout, Navigation, Error Handling, Testing) | PR-017     |
| PR-019 | `pr/F3.5-patterns`   | F3.5.10-F3.5.13 (API Client, State Components, Forms)       | PR-018     |

**Sprint 3 Deliverables:**

- ✅ Backend HTTP server (Fastify)
- ✅ OAuth Shopify complet
- ✅ Webhooks endpoint cu HMAC
- ✅ Frontend shell cu Polaris

---

### Sprint 4 (Săptămâna 4): Async Processing Infrastructure

#### F4.1: Queue Manager

| PR #   | Branch                     | Tasks                                             | Dependențe |
| ------ | -------------------------- | ------------------------------------------------- | ---------- |
| PR-020 | `pr/F4.1-queue-manager`    | F4.1.1-F4.1.4 (BullMQ Pro, taxonomie cozi, DLQ)   | PR-015     |
| PR-021 | `pr/F4.1-refactor-enqueue` | F4.1.5-F4.1.8 (Refactor din F3, worker hardening) | PR-020     |

#### F4.2: Fairness Multi-tenant

| PR #   | Branch                    | Tasks                                                    | Dependențe |
| ------ | ------------------------- | -------------------------------------------------------- | ---------- |
| PR-022 | `pr/F4.2-groups-fairness` | F4.2.1-F4.2.6 (BullMQ Groups, RLS wrapper, prioritizare) | PR-021     |

#### F4.3: Rate Limiting

| PR #   | Branch                  | Tasks                                          | Dependențe |
| ------ | ----------------------- | ---------------------------------------------- | ---------- |
| PR-023 | `pr/F4.3-rate-limiting` | F4.3.1-F4.3.6 (Lua script, backoff, bulk lock) | PR-022     |

#### F4.4: Queue Observability

| PR #   | Branch               | Tasks                                            | Dependențe |
| ------ | -------------------- | ------------------------------------------------ | ---------- |
| PR-024 | `pr/F4.4-queue-otel` | F4.4.1-F4.4.5 (Spans, metrics, logs pentru cozi) | PR-023     |

#### F4.5: Queue UI

| PR #   | Branch             | Tasks                                                  | Dependențe     |
| ------ | ------------------ | ------------------------------------------------------ | -------------- |
| PR-025 | `pr/F4.5-queue-ui` | F4.5.1-F4.5.8 (Metrici, Jobs List, Workers, WebSocket) | PR-024, PR-019 |

**Sprint 4 Deliverables:**

- ✅ BullMQ Pro cu fairness
- ✅ Rate limiting distribuit
- ✅ Queue observability
- ✅ Queue monitoring UI

---

### Sprint 5 (Săptămâna 5): Frontend Expansion (Embedded UX + Data Fetching + UI Library)

#### F3.7: Shopify Embedded UX Foundation

| PR #   | Branch                        | Tasks                                                      | Dependențe     |
| ------ | ----------------------------- | ---------------------------------------------------------- | -------------- |
| PR-026 | `pr/F3.7-app-bridge-provider` | F3.7.1 (App Bridge Provider, Embedded bootstrap)           | PR-019         |
| PR-027 | `pr/F3.7-oauth-callback-ui`   | F3.7.4 (OAuth callback page, admin redirect, safety)       | PR-026, PR-014 |
| PR-028 | `pr/F3.7-session-ux`          | F3.7.2-F3.7.3 (Session token UX, auto-refresh, multi-shop) | PR-026, PR-014 |

#### F3.8: Data Fetching Patterns (React Router v7)

| PR #   | Branch                     | Tasks                                                  | Dependențe |
| ------ | -------------------------- | ------------------------------------------------------ | ---------- |
| PR-029 | `pr/F3.8-loaders`          | F3.8.1 (Loaders pattern, typed route data)             | PR-019     |
| PR-030 | `pr/F3.8-actions`          | F3.8.2 (Actions pattern, form submissions)             | PR-029     |
| PR-031 | `pr/F3.8-adr-polling`      | F3.8.3-F3.8.4 (ADR Query vs loaders, polling hook)     | PR-030     |
| PR-032 | `pr/F3.8-optimistic-cache` | F3.8.5-F3.8.6 (Optimistic updates, cache invalidation) | PR-031     |

#### F3.9 + F3.6: UI Library & Dashboard Extensions

| PR #   | Branch                    | Tasks                                                         | Dependențe             |
| ------ | ------------------------- | ------------------------------------------------------------- | ---------------------- |
| PR-033 | `pr/F3.9-ui-primitives`   | F3.9.1-F3.9.4 (VirtualList, JsonViewer, TreeView, Charts)     | PR-019                 |
| PR-034 | `pr/F3.6-dashboard-ext`   | F3.6.1-F3.6.3 + F3.9.5-F3.9.10 (Dashboard charts + alerts)    | PR-033, PR-032, PR-025 |
| PR-035 | `pr/F3.9-advanced-inputs` | F3.9.11-F3.9.14 (SearchInput, DateRange, MultiSelect, Upload) | PR-033                 |

**Sprint 5 Deliverables:**

- ✅ Embedded Shopify UX foundation (App Bridge + callback + token UX)
- ✅ Standard patterns pentru loaders/actions/polling/optimistic updates
- ✅ UI component library avansată + dashboard extins

---

### Sprint 6-7 (Săptămânile 6-7): Bulk Ingestion Pipeline

#### F5.1: Bulk Operations Orchestrator

| PR #   | Branch                 | Tasks                                             | Dependențe |
| ------ | ---------------------- | ------------------------------------------------- | ---------- |
| PR-036 | `pr/F5.1-orchestrator` | F5.1.1-F5.1.3 (Orchestrator, state machine, lock) | PR-023     |
| PR-037 | `pr/F5.1-poller`       | F5.1.4-F5.1.5 (Poller, rate limit integration)    | PR-036     |
| PR-038 | `pr/F5.1-queries`      | F5.1.6-F5.1.7 (Stitched queries, failure policy)  | PR-037     |
| PR-039 | `pr/F5.1-mutations`    | F5.1.8-F5.1.9 (Bulk mutations, reconciliere)      | PR-038     |

#### F5.2: Streaming Pipeline

| PR #   | Branch                    | Tasks                                                   | Dependențe     |
| ------ | ------------------------- | ------------------------------------------------------- | -------------- |
| PR-040 | `pr/F5.2-streaming`       | F5.2.1-F5.2.3 (Download, parse JSONL)                   | PR-039         |
| PR-041 | `pr/F5.2-stitching`       | F5.2.4, F5.2.11 (Transform, parent-child remap)         | PR-040         |
| PR-042 | `pr/F5.2-copy-merge`      | F5.2.5-F5.2.8 (COPY writer, staging, merge, checkpoint) | PR-041         |
| PR-043 | `pr/F5.2-dedup-consensus` | F5.2.9-F5.2.10 (Deduplicare semantică, consensus)       | PR-042, PR-010 |

#### F5.3: Ingestion Observability

| PR #   | Branch        | Tasks                              | Dependențe |
| ------ | ------------- | ---------------------------------- | ---------- |
| PR-044 | `pr/F5.3-obs` | F5.3.1-F5.3.2 (OTel spans, events) | PR-043     |

#### F5.4: Testing & Hardening

| PR #   | Branch          | Tasks                                                | Dependențe |
| ------ | --------------- | ---------------------------------------------------- | ---------- |
| PR-045 | `pr/F5.4-tests` | F5.4.1-F5.4.4 (Unit, integration, chaos, load tests) | PR-044     |

#### F5.5: Ingestion UI

| PR #   | Branch                 | Tasks                                                      | Dependențe     |
| ------ | ---------------------- | ---------------------------------------------------------- | -------------- |
| PR-046 | `pr/F5.5-ingestion-ui` | F5.5.1-F5.5.9 (Progress, Log Console, History, Scheduling) | PR-045, PR-025 |

**Sprint 6-7 Deliverables:**

- ✅ Bulk Operations complete
- ✅ Streaming JSONL pipeline
- ✅ COPY în Postgres cu staging
- ✅ Deduplicare semantică
- ✅ Ingestion UI

---

### Sprint 8 (Săptămâna 8): AI & Vector Search

#### F6.1: Embeddings Pipeline

| PR #   | Branch                        | Tasks                                      | Dependențe |
| ------ | ----------------------------- | ------------------------------------------ | ---------- |
| PR-047 | `pr/F6.1-embeddings-schema`   | F6.1.1-F6.1.2 (Schema, content builder)    | PR-010     |
| PR-048 | `pr/F6.1-batch-orchestration` | F6.1.3-F6.1.5 (OpenAI Batch, poll, upsert) | PR-047     |
| PR-049 | `pr/F6.1-backfill`            | F6.1.6-F6.1.7 (Retry, backfill)            | PR-048     |

#### F6.2: pgvector Optimization

| PR #   | Branch             | Tasks                                                | Dependențe |
| ------ | ------------------ | ---------------------------------------------------- | ---------- |
| PR-050 | `pr/F6.2-pgvector` | F6.2.1-F6.2.4 (HNSW tuning, API search, Redis cache) | PR-049     |

#### F6.3: AI Observability & Testing

| PR #   | Branch           | Tasks                                    | Dependențe |
| ------ | ---------------- | ---------------------------------------- | ---------- |
| PR-051 | `pr/F6.3-ai-obs` | F6.3.1-F6.3.5 (OTel AI, tests, runbooks) | PR-050     |

#### F6.4-F6.6: AI & Products UI

| PR #   | Branch                | Tasks                                                 | Dependențe     |
| ------ | --------------------- | ----------------------------------------------------- | -------------- |
| PR-052 | `pr/F6.4-search-ui`   | F6.4.1-F6.4.6 (Search Playground)                     | PR-051, PR-046 |
| PR-053 | `pr/F6.5-settings-ui` | F6.5.1-F6.5.4 (Settings pages)                        | PR-052         |
| PR-054 | `pr/F6.6-products-ui` | F6.6.1-F6.6.10 (Products page, detail, import/export) | PR-053         |

**Sprint 8 Deliverables:**

- ✅ OpenAI Batch Embeddings
- ✅ pgvector optimizat
- ✅ AI Search UI
- ✅ Products management UI

---

### Sprint 9 (Săptămâna 9): Golden Record Strategy - External Product Search

> [!IMPORTANT]
> **CONFORM AUDIT SCHEMA 2025-12-29:** Acest sprint implementează strategia completă pentru Golden Records prin integrare cu surse externe de date.
> Această funcționalitate este **CORE** pentru aplicație și trebuie finalizată ÎNAINTE de producție!
>
> **Documentație:** `Docs/External_Product_APIs_Integration.md`

#### F8.4.1-F8.4.3: External Search & Extraction

| PR #   | Branch                    | Tasks                                                       | Dependențe |
| ------ | ------------------------- | ----------------------------------------------------------- | ---------- |
| PR-055 | `pr/F8.4.1-google-search` | F8.4.1 (Serper API integration, GTIN/MPN search)            | PR-054     |
| PR-056 | `pr/F8.4.2-similarity`    | F8.4.2 (prod_similarity_matches CRUD, business logic)       | PR-055     |
| PR-057 | `pr/F8.4.3-xai-extractor` | F8.4.3 (xAI Grok structured extraction, anti-hallucination) | PR-056     |

#### F8.4.4-F8.4.6: Enrichment Pipeline & Quality Promotion

| PR #   | Branch                   | Tasks                                                       | Dependențe |
| ------ | ------------------------ | ----------------------------------------------------------- | ---------- |
| PR-058 | `pr/F8.4.4-enrich-queue` | F8.4.4 (BullMQ enrichment queue, rate limiting per source)  | PR-057     |
| PR-059 | `pr/F8.4.5-consensus`    | F8.4.5 (Multi-source consensus engine, conflict resolution) | PR-058     |
| PR-060 | `pr/F8.4.6-promotion`    | F8.4.6 (Quality level promotion logic bronze→silver→golden) | PR-059     |

#### F8.4.7-F8.4.10: Operations & Fallback

| PR #   | Branch                 | Tasks                                              | Dependențe |
| ------ | ---------------------- | -------------------------------------------------- | ---------- |
| PR-061 | `pr/F8.4.7-cost-track` | F8.4.7 (API cost tracking, budget alerts)          | PR-058     |
| PR-062 | `pr/F8.4.8-pim-mvs`    | F8.4.8 (PIM progress dashboard MVs, API endpoints) | PR-060     |
| PR-063 | `pr/F8.4.9-webhooks`   | F8.4.9 (Quality events webhook system)             | PR-060     |
| PR-064 | `pr/F8.4.10-scraper`   | F8.4.10 (Playwright scraper fallback, robots.txt)  | PR-058     |

**Sprint 9 Deliverables:**

- ✅ Serper API integration pentru product discovery
- ✅ xAI Grok extraction cu anti-hallucination
- ✅ Multi-source consensus engine pentru Golden Records
- ✅ Automatic quality level promotion (bronze→silver→golden)
- ✅ Cost tracking și budget alerts
- ✅ PIM progress metrics dashboard
- ✅ Webhook notifications pentru quality events
- ✅ Fallback web scraper cu Playwright

---

### Sprint 10 (Săptămâna 10-11): Production & CI/CD

> [!IMPORTANT]
> **ULTIMUL SPRINT:** Production deployment se face DOAR după ce toate funcționalitățile core (inclusiv Golden Record PIM) sunt complete și testate!

#### F7.0: Production Foundation

| PR #   | Branch                 | Tasks                                             | Dependențe |
| ------ | ---------------------- | ------------------------------------------------- | ---------- |
| PR-065 | `pr/F7.0-adr-platform` | F7.0.1-F7.0.2 (ADR, Ansible, Docker Compose)      | PR-064     |
| PR-066 | `pr/F7.0-infra`        | F7.0.3-F7.0.7 (Postgres, Redis, Secrets, Ingress) | PR-065     |

#### F7.1: Observability Production

| PR #   | Branch                 | Tasks                                                     | Dependențe |
| ------ | ---------------------- | --------------------------------------------------------- | ---------- |
| PR-067 | `pr/F7.1-otel-prod`    | F7.1.1-F7.1.5 (OTel Collector, sampling, dashboards, SLO) | PR-066     |
| PR-068 | `pr/F7.1-loki-grafana` | F7.1.1.1-F7.1.1.6 (Loki, Grafana provisioning)            | PR-067     |
| PR-069 | `pr/F7.1-sli-slo`      | F7.1.3.1-F7.1.3.2 (DB/Redis obs, SLI/SLO)                 | PR-068     |

#### F7.2: Build & Supply Chain

| PR #   | Branch                | Tasks                                      | Dependențe |
| ------ | --------------------- | ------------------------------------------ | ---------- |
| PR-070 | `pr/F7.2-docker-prod` | F7.2.1-F7.2.4 (Multi-stage, SBOM, scanări) | PR-069     |

#### F7.3: CI/CD Complet

| PR #   | Branch                | Tasks                                                 | Dependențe |
| ------ | --------------------- | ----------------------------------------------------- | ---------- |
| PR-071 | `pr/F7.3-ci-complete` | F7.3.1-F7.3.6 (CI complet, CD staging/prod, migrații) | PR-070     |

#### F7.4: Disaster Recovery

| PR #   | Branch       | Tasks                                                 | Dependențe |
| ------ | ------------ | ----------------------------------------------------- | ---------- |
| PR-072 | `pr/F7.4-dr` | F7.4.1-F7.4.5 (Backups, Redis, kill-switch, DR drill) | PR-071     |

#### F7.5: Production Readiness

| PR #   | Branch        | Tasks                                                      | Dependențe |
| ------ | ------------- | ---------------------------------------------------------- | ---------- |
| PR-073 | `pr/F7.5-sre` | F7.5.1-F7.5.4 (Resurse, scaling, runbooks, 10K simulation) | PR-072     |

#### F7.6-F7.8: Frontend Quality

| PR #   | Branch                     | Tasks                                            | Dependențe |
| ------ | -------------------------- | ------------------------------------------------ | ---------- |
| PR-074 | `pr/F7.6-frontend-quality` | F7.6.1-F7.6.9 (A11y, performance, E2E, i18n)     | PR-064     |
| PR-075 | `pr/F7.7-obs-ui`           | F7.7.1-F7.7.4 (Health dashboard, metrics, audit) | PR-074     |
| PR-076 | `pr/F7.8-hooks-library`    | F7.8.1-F7.8.5 (Data, real-time, UI hooks)        | PR-075     |

**Sprint 10 Deliverables:**

- ✅ Infrastructure production-ready
- ✅ CI/CD complet cu CD staging/prod
- ✅ Observability stack (Loki, Grafana)
- ✅ DR procedures
- ✅ Frontend quality & hooks
- ✅ **APLICAȚIE COMPLETĂ GATA DE PRODUCȚIE**

---

### Summary: PR Count per Sprint

| Sprint  | Săptămâna  | PRs                  | Focus                      |
| ------- | ---------- | -------------------- | -------------------------- |
| S1      | W1         | PR-001 → PR-004 (4)  | Foundation                 |
| S2      | W2         | PR-005 → PR-012 (8)  | Data Layer                 |
| S3      | W3         | PR-013 → PR-019 (7)  | Backend + Frontend Shell   |
| S4      | W4         | PR-020 → PR-025 (6)  | Async Processing           |
| S5      | W5         | PR-026 → PR-035 (10) | Frontend Expansion         |
| S6-7    | W6-7       | PR-036 → PR-046 (11) | Bulk Ingestion             |
| S8      | W8         | PR-047 → PR-054 (8)  | AI & Vector Search         |
| **S9**  | **W9**     | PR-055 → PR-064 (10) | **Golden Record Strategy** |
| **S10** | **W10-11** | PR-065 → PR-076 (12) | **Production (FINAL)**     |

> **Total: 76 PRs**
>
> ⚠️ **IMPORTANT:** Production (S10) este ULTIMUL sprint! Aplicația trebuie să fie complet funcțională ÎNAINTE de deploy în producție.

---

### Decizii Necesare Înainte de Start

> [!WARNING]
> Următoarele decizii trebuie luate explicit înainte de Sprint 1:

1. **F1.3.7.1:** Pre-push hook pentru teste SAU teste doar în CI?
2. **F3.8.3:** TanStack Query SAU doar React Router loaders?
3. **F7.0.1:** Platformă deploy (confirmare bare metal + Docker Compose)?
