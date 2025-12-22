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

25. Faza F5: Pipeline-ul de ingestie „Stitched” (Săptămâna 5-6)

26. F5.1: Orchestrare Shopify Bulk Ops (query + mutation, multi-tenant safe)

27. F5.2: Pipeline streaming JSONL → transform → COPY (Postgres)

28. F5.3: Observabilitate ingestie & bulk

29. F5.4: Testing & hardening (CI-friendly)

30. Faza F6: Integrare AI & Vector Search (Săptămâna 7)

31. F6.1: Integrare OpenAI pentru generare embeddings (procesare batch)

32. F6.2: Căutare vectorială cu Redis 8.4 / RediSearch (index vectorial și sincronizare date)

33. Faza F7: CI/CD, Observabilitate și Producție (Săptămâna 8)

34. F7.0: Foundation Producție (platformă, medii, Ops, secrete)

35. F7.1: Observabilitate prod (OTel Collector, SLO, dashboards)

36. F7.2: Build & Supply Chain (Docker multi-stage, SBOM, semnare)

37. F7.3: CI/CD complet (Gating, Zero-downtime migrations, SSH Auth)

38. F7.4: Data Safety & DR (PITR, Backup drills, Kill-switches)

39. F7.5: Production Readiness (SRE, Autoscaling, Runbooks)

## 1. Introducere

Documentația aferentă proiectului Manager Shopify cuprinde mai multe materiale ce descriu arhitectura și planul de implementare pentru o aplicație Shopify de tip enterprise, capabilă să gestioneze un volum masiv de date (peste 1 milion de SKU-uri). Analiza critică a acestor documente evidențiază atât o viziune unitară, cât și unele inadvertențe și erori ce trebuie reconciliate în planul final:
    - Structura pe faze și sub-faze: Planul tehnic este împărțit în etape DevOps (Faze F0–F7 în prezentul document) ce progresează de la configurarea mediului de dezvoltare, la implementarea stratului de date, logica de business, integrarea AI și, în final, livrarea în producție cu CI/CD și monitorizare. Documentul „Plan Implementare Aplicație Completă” prezintă o structurare similară (Faza 1–6), însă cu o grupare ușor diferită a priorităților (de exemplu, guvernanța multi-tenant și echitatea resurselor apar ca fază separată spre final, pe când în planul DevOps acestea sunt adresate mai devreme, în faza de infrastructură asincronă). Pentru coerentizare, planul final aliniază aceste faze într-o secvență logică F0–F7 care acoperă toate aspectele.

    - Stiva tehnologică și alegeri de implementare: Toate materialele converg spre un stack modern orientat pe performanță: Node.js v24 LTS (Krypton) pentru server, **PostgreSQL 18.1** pentru baza de date relațională, **Redis 8.4.0** (cu module RediSearch și RedisJSON) pentru cache, cozi și vector search, și un monorepo JavaScript/TypeScript gestionat cu pnpm. Testare standardizată: **backend (apps/backend-worker) rulează pe `node:test` + `node --watch --test`**, iar **frontend (apps/web-admin) rulează pe Vitest (ecosistem Vite/RR7)**; **Jest nu este folosit**. Se pune accent pe instrumente moderne: BullMQ Pro pentru cozi distribuite și fairness multi-tenant, OpenTelemetry pentru observabilitate și integrarea OpenAI pentru capabilități AI. Totuși, există inconsistențe notabile în descrierea unora dintre aceste alegeri:
    
    - ORM și gestionarea bazei de date: Standardul proiectului este **Drizzle ORM** (pentru acces tipizat la PostgreSQL) împreună cu **drizzle-kit** pentru migrații SQL. Abordarea păstrează migrațiile SQL ca sursă de adevăr, ceea ce ajută la funcționalități avansate precum Row Level Security (RLS) și la control operațional mai bun în producție.

    - Framework front-end vs. backend combinat: Documentația discută fuziunea Remix cu React Router (contextul anului 2025) și posibilitatea utilizării șablonului oficial Shopify App (bazat pe Remix) pentru front-end. În același timp, structura proiectului evidențiază un front-end React separat (admin UI integrată în Shopify via iframe) în folderul apps/web-admin, distinct de serviciul backend Node.js din apps/backend-worker. Planul final clarifică abordarea: se folosește un front-end React standalone (React Router v7) pentru interfața de administrare (embedded în Shopify), în timp ce backend-ul Node (Fastify) gestionează API-urile și procesările asincrone. S-a considerat alternativă utilizarea Remix pentru a unifica front-end-ul cu backend-ul, însă s-a optat pentru separare pentru o modularitate mai bună și control sporit al performanței.

    - Nume și structură de proiect: În documente apar denumiri ușor diferite pentru aceleași componente (ex: serviciul backend este numit apps/web în planul DevOps și apps/backend-worker în structura de proiect). Planul final adoptă nomenclatura din structura actuală a codului (backend-worker pentru serviciul Node principal, respectiv web-admin pentru front-end), asigurând consistența în tot documentul.

    - Aspecte omise sau implicite: Unele detalii apar într-un document și lipsesc în altele, necesitând integrare: de exemplu, planul DevOps include configurarea hooks Git (Husky) și testare automatizată, aspecte neabordate direct în raportul arhitectural, dar esențiale pentru calitatea codului; invers, raportul complet discută pe larg guvernanța multi-tenant (asigurarea că niciun magazin Shopify nu monopolizează resursele comune), ceea ce în planul tehnic DevOps este tratat la nivel practic (strategie de fairness în coada BullMQ și politici RLS în Postgres). Planul final explicită toate aceste elemente, adăugând pași concreți pentru implementarea lor.

    - Erori minore și corectitudinea planificării: S-au identificat câteva greșeli de redactare și potențiale probleme logice: de pildă, termenul “Migrații Initiale” apare scris fără diacritice într-un document, iar într-altul cu diacritice (“Migrații Inițiale”); un alt exemplu este utilizarea sintagmei “See” în loc de “Seed” într-o secțiune, probabil din cauza unei erori de transcriere. De asemenea, în documentație au existat mențiuni amestecate de versiuni PostgreSQL (15/16/18). În acest plan, stiva este standardizată și pin-uită pe **PostgreSQL 18.1** pentru reproductibilitate (inclusiv în exemplele de Docker). Din perspectivă logică, secvența de faze este solidă, acoperind treptat toate cerințele. O potențială îngrijorare este volumul mare de date și timpii de execuție (ex.: actualizarea 1M produse ar dura ~5,7 zile la 2 req/sec dacă s-ar folosi API-uri sincrone standard, conform analizei), fapt ce justifică pe deplin abordările asincrone propuse (Bulk Operations și pipeline de streaming) – planul final le include ca element central.

În concluzie, planul final unifică perspectivele diferitelor documente într-o strategie coerentă de implementare. În cele ce urmează este prezentat Planul final de implementare Manager Shopify, structurat pe faze F0–F7, fiecare împărțită în sub-faze (ex. F1.2 indică sub-faza 2 din Faza 1) și detaliată la nivel de task-uri granular. Fiecare task este descris în format JSON – incluzând numele, descrierea detaliată, locația de implementare în proiect, contextul anterior, criteriile de validare/testare, rezultatul așteptat și restricții explicite pentru a evita orice deviație de la scopul definit. Acest plan este redactat în limba română, ca document formal DevOps, și poate fi folosit atât de ingineri pentru implementare, cât și de agenți automatizați pentru a parcurge pașii în mod controlat.

---

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
    }
    
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
        "descriere_task": "Creează fișierul `.env.example` la rădăcina proiectului care listează TOATE variabilele de mediu necesare conform DevOps_Plan_Implementare_Shopify_Enterprise.md, cu valori placeholder. Acest fișier SE COMITE în Git și servește ca șablon pentru `.env` (care NU se comite).\n\nConținut **COMPLET** obligatoriu:\n```\n# ============================================\n# DATABASE (PostgreSQL 18.1)\n# ============================================\nDATABASE_URL=postgresql://user:password@localhost:5432/neanelu_shopify\nDB_POOL_SIZE=10\n\n# ============================================\n# REDIS 8.4\n# ============================================\nREDIS_URL=redis://localhost:6379\n\n# ============================================\n# SHOPIFY API\n# ============================================\nSHOPIFY_API_KEY=your_api_key_here\nSHOPIFY_API_SECRET=your_api_secret_here\nSCOPES=read_products,write_products,read_orders\n\n# ============================================\n# BULLMQ PRO (registry privat + runtime)\n# ============================================\nNPM_TASKFORCESH_TOKEN=your_bullmq_pro_npm_token\nBULLMQ_PRO_TOKEN=your_bullmq_pro_license_token\n\n# ============================================\n# OPENAI / AI ENGINE\n# ============================================\nOPENAI_API_KEY=your_openai_api_key\n\n# ============================================\n# SECURITY & ENCRYPTION\n# ============================================\nENCRYPTION_KEY_256=your_32_byte_hex_key_here\n\n# ============================================\n# APPLICATION\n# ============================================\nAPP_HOST=https://localhost:3000\nNODE_ENV=development\nLOG_LEVEL=debug\n\n# ============================================\n# OBSERVABILITY (OpenTelemetry)\n# ============================================\nOTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318\nOTEL_SERVICE_NAME=neanelu-shopify\n```\n\nDe asemenea, confirmă că `.env` este în `.gitignore`.\n\n**Notă pentru staging/prod:** Aceste valori vor fi injectate din OpenBAO (self-hosted, Docker) prin mecanismul de deploy (OpenBAO Agent template → env-file pe host → docker compose --env-file). CI doar declanșează deploy-ul; nu ținem secrete în repo/imagini.",
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
        "descriere_task": "**OBLIGATORIU conform Stack Tehnologic:** Instalează TypeScript la root și configurează:\n\n1. **Instalare:** `pnpm add -Dw typescript @types/node`\n\n2. **Creare `tsconfig.base.json` la root:**\n```json\n{\n  \"compilerOptions\": {\n    \"target\": \"ES2024\",\n    \"module\": \"NodeNext\",\n    \"moduleResolution\": \"NodeNext\",\n    \"strict\": true,\n    \"esModuleInterop\": true,\n    \"skipLibCheck\": true,\n    \"declaration\": true,\n    \"declarationMap\": true,\n    \"sourceMap\": true,\n    \"outDir\": \"dist\",\n    \"rootDir\": \"src\",\n    \"resolveJsonModule\": true,\n    \"isolatedModules\": true,\n    \"baseUrl\": \".\",\n    \"paths\": {\n      \"@app/*\": [\"packages/*/src\"]\n    }\n  }\n}\n```\n\n3. **Creare `tsconfig.json` în fiecare workspace** care extinde tsconfig.base.json:\n```json\n{\n  \"extends\": \"../../tsconfig.base.json\",\n  \"compilerOptions\": {\n    \"outDir\": \"./dist\",\n    \"rootDir\": \"./src\"\n  },\n  \"include\": [\"src/**/*\"],\n  \"exclude\": [\"node_modules\", \"dist\"]\n}\n```\n\n4. **Adaugă scripturi în root package.json (cu --if-present pentru repo skeleton):**\n- `typecheck`: `pnpm -r --if-present run typecheck`\n- `build`: `pnpm -r --if-present run build`\n\n5. **DECIZIE EXPLICITĂ build strategy:**\n- Backend (apps/backend-worker): folosește `tsc` (nativ Node.js, fără bundler)\n- Frontend (apps/web-admin): folosește `vite build` (integrat cu React Router 7)\n- Packages: folosesc `tsc` pentru tipuri + declarații",
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
        "denumire_task": "Creare fișier .env.compose.example pentru servicii Docker (NU .env direct!)",
        "descriere_task": "**CONFORM standardului Docs:** Crează fișierul `.env.compose.example` la rădăcina proiectului care conține variabilele necesare DOAR pentru docker-compose (nu pentru aplicație). Acest fișier SE COMITE.\n\nConținut:\n```\n# Docker Compose Development Variables\n# Copiază acest fișier în .env.compose și completează valorile\n\n# PostgreSQL 18.1\nPOSTGRES_USER=shopify\nPOSTGRES_PASSWORD=shopify_dev_password\nPOSTGRES_DB=neanelu_shopify_dev\n\n# Nu include alte secrete aici - ele vin din .env (necomis)\n```\n\n**IMPORTANT:**\n- `.env.compose.example` SE COMITE (template)\n- `.env.compose` NU SE COMITE (valori locale, adăugat în .gitignore)\n- `.env` (pentru aplicație) rămâne separat și NU SE COMITE (definit în F0.2.7.1)",
        "cale_implementare": "/Neanelu_Shopify/.env.compose.example",
        "contextul_anterior": "Structura aplicației este definită. Urmează pregătirea serviciilor externe. CONFORM Docs, .env nu se comite niciodată; folosim .env.compose.example ca template.",
        "validare_task": "Verifică existența `.env.compose.example` cu variabilele Docker. CONFIRMĂ că `.env.compose` și `.env` sunt ambele în `.gitignore`. Copiază `.env.compose.example` în `.env.compose` pentru uz local.",
        "outcome_task": "Template-ul pentru variabile Docker este versionat, în timp ce valorile reale rămân locale și necomise.",
        "restrictii_antihalucinatie": "NU crea fișier `.env` direct pentru Docker - SEPARĂ config Docker de config aplicație. NU comite niciodată `.env` sau `.env.compose` - doar `.env.*.example`. VERIFICĂ că ambele sunt în .gitignore."
    },

    {
        "id_task": "F1.2.2",
        "denumire_task": "Definire serviciu Postgres (docker-compose base + dev override)",
        "descriere_task": "Creează `docker-compose.yml` (setări comune) și `docker-compose.dev.yml` (override local). În fișierul base definește serviciul `db` cu imaginea `postgres:18.1-alpine`, volum named și rețea. În override adaugă mapările de port (ex: `5432:5432`) și environment cu referințe din `.env` (POSTGRES_USER/PASSWORD/DB). Astfel, fișierul base rămâne neutru, iar specificul dev stă în override.",
        "cale_implementare": "/Neanelu_Shopify/docker-compose.yml (base) și /Neanelu_Shopify/docker-compose.dev.yml (override) — serviciul db",
        "contextul_anterior": "Fișierul .env este pregătit cu variabilele necesare. Începem să definim serviciile containerizate cu separare clară base vs. dev override.",
        "validare_task": "Deschide `docker-compose.yml` și `docker-compose.dev.yml` și verifică secțiunea `db`. Rulează `docker compose -f docker-compose.yml -f docker-compose.dev.yml config` pentru a valida configurația combinată și volumul named.",
        "outcome_task": "Serviciul Postgres este definit cu fișier base și override de dezvoltare, asigurând consistență între medii și porturi doar în dev.",
        "restrictii_antihalucinatie": "Nu pune parole în clar în docker-compose (folosește referințe la .env). Nu folosi imagine nespecifică (versiune 'latest' fără tag) – pentru reproductibilitate indică versiunea. Nu trece mai departe până când fișierul compose nu este valid sintactic."
    },

    {
        "id_task": "F1.2.3",
        "denumire_task": "Definire serviciu Redis 8.4 (base + dev override)",
        "descriere_task": "În `docker-compose.yml` (base) adaugă serviciul `redis` cu imagine `redis:8.4` și volum named. În `docker-compose.dev.yml` mapează porturile `6379:6379`. Modulele RedisJSON/RediSearch sunt incluse nativ în Redis 8.4 (nu mai e nevoie de redis-stack).",
        "cale_implementare": "/Neanelu_Shopify/docker-compose.yml și /Neanelu_Shopify/docker-compose.dev.yml (serviciul redis)",
        "contextul_anterior": "Serviciul de bază de date este definit. Următorul serviciu extern este Redis 8.4 pentru cozi, cache și vector search.",
        "validare_task": "Rulează `docker compose -f docker-compose.yml -f docker-compose.dev.yml config` și verifică secțiunea `redis:` (imagine, porturi, volume). Confirmă că volumul named este în secțiunea globală `volumes:`.",
        "outcome_task": "Redis 8.4 este definit cu un fișier base și override dev, păstrând consistența și expunând porturile doar în dev.",
        "restrictii_antihalucinatie": "Folosește imaginea `redis:8.4` (NU redis-stack care e deprecated Dec 2025). Redis 8.4 include nativ RediSearch/RedisJSON. Nu omite maparea portului 6379."
    },

    {
        "id_task": "F1.2.4",
        "denumire_task": "Definire serviciu Jaeger (base + dev override)",
        "descriere_task": "Adaugă serviciul `jaeger` în `docker-compose.yml` (base) cu imagine `jaegertracing/all-in-one:1.41`. În `docker-compose.dev.yml` mapează portul UI 16686 (și 6831 dacă e nevoie). Nu sunt necesare variabile custom în dev; all-in-one are configurare implicită.",
        "cale_implementare": "/Neanelu_Shopify/docker-compose.yml și /Neanelu_Shopify/docker-compose.dev.yml (serviciul jaeger)",
        "contextul_anterior": "Pe lângă DB și cache, sistemul de observabilitate prin tracing este dorit. Definim Jaeger cu separare base/override pentru consistență între medii.",
        "validare_task": "Rulează `docker compose -f docker-compose.yml -f docker-compose.dev.yml config` și verifică secțiunea `jaeger:` (imagine și porturi). După start, confirmă UI pe http://localhost:16686.",
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
        "descriere_task": "**IMPORTANT:** Conform principiului 'nu instalăm Postgres/Redis local', verificările se fac DOAR prin containere.\n\n**1. Verificare Postgres (docker exec):**\n```bash\ndocker compose exec db psql -U shopify -d neanelu_shopify_dev -c 'SELECT 1;'\n```\nTrebuie să returneze `1` fără erori.\n\n**2. Verificare Redis 8.4 (docker exec):**\n```bash\n# PING test\ndocker compose exec redis redis-cli ping\n# Trebuie să returneze PONG\n\n# Verifică module RediSearch/RedisJSON (incluse nativ în Redis 8.4)\ndocker compose exec redis redis-cli MODULE LIST\n# Trebuie să listeze: search, ReJSON, bf (bloom filter), etc.\n\n# Alternativ, test specific RediSearch:\ndocker compose exec redis redis-cli FT._LIST\n# Returnează array gol [] (OK) sau eroare (NOK)\n```\n\n**3. (Opțional) PgAdmin pentru DX:**\nDacă echipa vrea un GUI pentru Postgres, adaugă în docker-compose.dev.yml:\n```yaml\n  pgadmin:\n    image: dpage/pgadmin4:latest\n    ports:\n      - \"5050:80\"\n    environment:\n      PGADMIN_DEFAULT_EMAIL: admin@local.dev\n      PGADMIN_DEFAULT_PASSWORD: admin\n    depends_on:\n      - db\n```\nAccesibil la http://localhost:5050",
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
        "descriere_task": "Adaugă fișierele noi și modificate la Git:\n\n**SE COMIT:**\n- `docker-compose.yml`\n- `docker-compose.dev.yml`\n- `.env.compose.example` (template)\n- actualizările `package.json` cu scripturile db:up/down\n\n**NU SE COMIT (verifică .gitignore):**\n- `.env` (secrete aplicație)\n- `.env.compose` (valori Docker locale)\n\nEfectuează un commit cu mesajul 'Add docker-compose config for Postgres, Redis 8.4, Jaeger'. Apoi, împinge modificările la remote.",
        "cale_implementare": "Repository Git local (și remote origin)",
        "contextul_anterior": "Mediul containerizat este pregătit și verificat. Este esențial să înregistrăm doar template-urile, NU valorile reale.",
        "validare_task": "VERIFICĂ `git status` - `.env` și `.env.compose` NU trebuie să apară în lista de fișiere staged. Doar `.env.compose.example` trebuie să fie comis. După commit, verifică pe GitHub că `.env` NU apare în repository.",
        "outcome_task": "Configurația Docker este versionată cu template-uri, fără secrete sau valori locale.",
        "restrictii_antihalucinatie": "NU COMITE niciodată `.env` sau `.env.compose` - doar `.env.*.example`. Verifică DE DOUĂ ORI .gitignore înainte de commit. Dacă vezi `.env` în `git status`, oprește-te și adaugă-l în .gitignore!"
    },

    {
        "id_task": "F1.2.9",
        "denumire_task": "Pregătire infrastructură OTel (Jaeger ready + skeleton files DOAR)",
        "descriere_task": "**NOTA:** Implementarea completă OTel vine DUPĂ ce există un backend runnable (F2). În F1 pregătim doar INFRASTRUCTURA:\n\n1. **Jaeger este deja în docker-compose** - verifică că pornește și UI-ul e accesibil pe http://localhost:16686\n\n2. **Crează skeleton files:**\n   - `packages/logger/src/index.ts` - export gol, placeholder\n   - `packages/logger/src/otel.ts` - comentariu 'OTel setup va fi implementat în F2'\n\n3. **Adaugă în .env.example** (deja făcut în F0.2.7.1):\n   - OTEL_EXPORTER_OTLP_ENDPOINT\n   - OTEL_SERVICE_NAME\n\n**NU IMPLEMENTA încă:**\n- SDK initialization\n- Trace exporters\n- Logging structurat\n\nAcestea vin în F2-F3 când există un main.ts + healthcheck.",
        "cale_implementare": "packages/logger/src/ (skeleton files)",
        "contextul_anterior": "Jaeger este disponibil în docker-compose. FÃRĂ un backend runnable, nu putem testa OTel complet.",
        "validare_task": "Verifică că Jaeger UI (http://localhost:16686) funcționează. Verifică existența skeleton-urilor în packages/logger/src/. NU aștepta span-uri - ele vor apărea în F2.",
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
        "contextul_anterior": "Structura monorepo este stabilă și serviciile externe configurate. Următorul pas este să ne asigurăm că menținem calitatea codului pe măsură ce dezvoltăm – prin configurarea de lintere și formatare automată la commit.",
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
        "contextul_anterior": "Husky este instalat și folderul de hook-uri e prezent. Urmează să configurăm efectiv un hook.",
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
        "contextul_anterior": "Hook-ul pre-commit invocă lint-staged, dar nu are încă definit ce să facă. Trebuie să specificăm acțiunile de lint/formatare dorite pe fișierele stagiate.",
        "validare_task": "Verifică în `package.json` că secțiunea `lint-staged` există și conține intrările corecte (pattern-urile de fișiere și comenzile). Simulează un caz: modifică un fișier TypeScript intenționat greșit formatat (ex. cu spațieri aiurea), fă `git add` și apoi `git commit -m 'test lint-staged'`. Ar trebui ca Prettier să ruleze și să formateze automat fișierul (poți vedea modificările de format dacă anulezi commit-ul după). De asemenea, ESLint cu --fix ar trebui să corecteze probleme simple. Dacă commit-ul trece (sau este oprit de vreo eroare de lint nereparabilă automat), înseamnă că lint-staged e funcțional.",
        "outcome_task": "Configurația lint-staged este în vigoare, asigurând că înainte de fiecare commit, codul este formatat și verificat conform regulilor stabilite (cel puțin pentru categoriile de fișiere specificate).",
        "restrictii_antihalucinatie": "Nu pune comenzi care modifică fișiere fără să fie și comise (prin design, lint-staged adaugă modificările făcute de Prettier în commit automat). Nu lăsa pattern-uri prea largi care să includă fișiere mari binare sau altele ne-necessare – țintește doar codul sursă. Nu continua fără să testezi că configurația chiar rulează la commit (pentru a evita falsa siguranță)."
    },

    {
        "id_task": "F1.3.5",
        "denumire_task": "Crearea configurărilor ESLint și Prettier",
        "descriere_task": "În rădăcina proiectului, adaugă fișierele de configurare pentru ESLint și Prettier. Creează un fișier `.eslintrc.json` cu o configurație de bază care extinde regulile recomandate pentru JavaScript și TypeScript (de ex. eslint:recommended și plugin:@typescript-eslint/recommended) și include integrarea Prettier (pentru a dezactiva regulile conflictuale de stil). Setează `parser` la `@typescript-eslint/parser` și `plugins` la `[ @typescript-eslint ]`. De asemenea, definește environment-urile relevante (ex: node: true, browser: false, es2020: true).\nCreează și un fișier `.prettierrc` simplu cu reguli de formatare dorite (ex: lățime maximă 100 de caractere, ghilimele simple la stringuri etc., conform preferințelor echipei). Nu uita să adaugi un fișier `.eslintignore` care să excludă `node_modules/` și eventual alte fișiere generate, precum și un `.prettierignore` similar (poți porni de la același conținut ca .eslintignore).",
        "cale_implementare": "/Neanelu_Shopify/.eslintrc.json, /Neanelu_Shopify/.prettierrc",
        "contextul_anterior": "Am configurat rularea automată a ESLint și Prettier, dar avem nevoie și de fișierele lor de configurare pentru a defini stilul și regulile proiectului.",
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
        "denumire_task": "Scanare rapidă de securitate pe PR (trivy fs)",
        "descriere_task": "Include un pas de scanare rapidă a filesystem-ului sursă cu trivy (mod fs) pentru a detecta CVE majore și dependențe compromise. Scanarea completă a imaginii (trivy image/grype) și semnarea SBOM rămân în F7, dar aici prindem devreme probleme critice de supply chain.",
        "cale_implementare": ".github/workflows/ci-pr.yml (pas scan-trivy-fs)",
        "contextul_anterior": "Nu există încă un control automat de securitate; adăugăm o verificare lightweight înainte de livrare finală.",
        "validare_task": "Rularea workflow-ului trebuie să afișeze raportul trivy fs; dacă există CVE critice, job-ul e marcat failed. Verifică că durata rămâne rezonabilă (<2-3 minute) folosind cache local.",
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
        "denumire_task": "Activare extensii PostgreSQL baseline (pgcrypto, citext, pg_trgm)",
        "descriere_task": "**Enterprise DB Setup:** Prima migrație trebuie să activeze extensiile necesare:\n\n**Migrație SQL (0000_enable_extensions.sql):**\n```sql\n-- Extensii necesare pentru schema și performanță\n-- NOTĂ: UUIDv7 este nativ în PG18 (uuidv7()), nu necesită extensie ossp\nCREATE EXTENSION IF NOT EXISTS \"pgcrypto\";\nCREATE EXTENSION IF NOT EXISTS \"citext\";\nCREATE EXTENSION IF NOT EXISTS \"pg_trgm\";\nCREATE EXTENSION IF NOT EXISTS \"btree_gin\";\n```\n\n**Decizie partitionare (documentează explicit):**\n- Pentru 1M+ SKU, partitionarea după `shop_id` crește performanța\n- Dacă NU partiționezi, documentează motivul",
        "cale_implementare": "/Neanelu_Shopify/packages/database/drizzle/migrations/0000_enable_extensions.sql",
        "contextul_anterior": "drizzle-kit este configurat. Extensiile trebuie activate ÎNAINTE de schema.",
        "validare_task": "Rulează `SELECT extname FROM pg_extension;` și confirmă prezența extensiilor.",
        "outcome_task": "PostgreSQL are extensiile necesare pentru UUIDv7, criptare și indexing.",
        "restrictii_antihalucinatie": "NU sări peste acest pas - schema va eșua fără pgcrypto (pentru auth)."
    },

    {
        "id_task": "F2.1.2.2",
        "denumire_task": "Definire roluri DB și privilegii (bootstrap privilegiat, NU migrație drizzle)",
        "descriere_task": "**IMPORTANT: Acesta NU este un pas drizzle-kit!**\n\n**De ce NU migrație drizzle:**\n- Migrațiile drizzle rulează cu rol unic\n- Crearea rolurilor necesită superuser/CREATEROLE\n- Parolele NU trebuie să apară în fișiere versionate\n\n**Script bootstrap (scripts/db-bootstrap.sh):**\n```bash\n#!/bin/bash\n# Rulează O SINGURĂ DATĂ per mediu cu credentiale superuser\nexport PGPASSWORD=\"$POSTGRES_SUPERUSER_PASSWORD\"\n\npsql -h \"$DB_HOST\" -U postgres -d \"$DB_NAME\" <<SQL\nCREATE ROLE app_migrator WITH LOGIN;\nCREATE ROLE app_runtime WITH LOGIN;\n\nGRANT ALL PRIVILEGES ON SCHEMA public TO app_migrator;\nGRANT USAGE ON SCHEMA public TO app_runtime;\nGRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;\nGRANT SET ON PARAMETER app.current_shop_id TO app_runtime;\nSQL\n\n# Parolele se setează separat din OpenBAO (secret manager)\npsql -U postgres -c \"ALTER ROLE app_migrator PASSWORD '$MIGRATION_DB_PASSWORD'\"\npsql -U postgres -c \"ALTER ROLE app_runtime PASSWORD '$RUNTIME_DB_PASSWORD'\"\n```\n\n**Environment variables:**\n- `DATABASE_URL_MIGRATE` - rol app_migrator\n- `DATABASE_URL` - rol app_runtime",
        "cale_implementare": "/Neanelu_Shopify/scripts/db-bootstrap.sh",
        "contextul_anterior": "Extensiile sunt activate. Bootstrap-ul se rulează O DATĂ per mediu.",
        "validare_task": "Conectează-te cu app_runtime și verifică că NU poți DROP TABLE dar poți SELECT/INSERT.",
        "outcome_task": "Least privilege implementat. Parolele NU sunt în cod.",
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
        "descriere_task": "Definește tabelele inițiale cu structură enterprise și UUIDv7 nativ PostgreSQL 18:\n\n**STANDARD UUIDv7 (PostgreSQL 18 nativ):**\n- Tipul coloanei: `uuid` (tipul standard Postgres)\n- Funcția de generare: `uuidv7()` (nou în PG18, time-ordered)\n- Cast: `::uuid` (nu ::UUIDv7 - tipul e tot uuid)\n\n**shops:**\n- id uuid PRIMARY KEY DEFAULT uuidv7()\n- shopify_domain citext UNIQUE\n- name, email, plan\n- created_at, updated_at\n\n**products:**\n- id uuid PRIMARY KEY DEFAULT uuidv7()\n- shop_id uuid REFERENCES shops(id)\n- shopify_id bigint\n- title, handle citext\n- metafields jsonb\n- created_at, updated_at\n\n**shopify_tokens (criptare AEAD):**\n- id uuid PRIMARY KEY DEFAULT uuidv7()\n- shop_id uuid UNIQUE REFERENCES shops(id)\n- access_token_ciphertext bytea\n- access_token_iv bytea (12 bytes AES-GCM)\n- access_token_tag bytea (16 bytes auth tag)\n- key_version int\n- scopes text[]\n- created_at, rotated_at\n\n**bulk_runs:**\n- id uuid PRIMARY KEY DEFAULT uuidv7()\n- shop_id uuid REFERENCES shops(id)\n- status text CHECK (status IN ('PENDING', 'RUNNING', 'POLLING', 'DOWNLOADING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELED'))\n- started_at, completed_at\n- records_processed int\n\n**Indexuri și constraints (CONFORM Strategie_dezvoltare.md):**\n```sql\n-- UNIQUE constraint: shopify_id unic per shop\nCREATE UNIQUE INDEX idx_products_shop_shopify_id ON products(shop_id, shopify_id);\nCREATE INDEX idx_products_shop_id ON products(shop_id);\nCREATE INDEX idx_products_metafields ON products USING GIN(metafields);\nCREATE INDEX idx_products_title_trgm ON products USING GIN(title gin_trgm_ops);\n```",
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
        "descriere_task": "**Definește strategia de migrații pentru producție:**\n\n**1. Strategie de rollback (documentată explicit):**\n- **Forward-only cu migrații compensatorii** (recomandat pentru schema critică)\n- SAU down-migrations (mai complex, risc de pierdere date)\n- DOCUMENTEAZĂ alegerea în README packages/database\n\n**2. Migrații pe medii (dev/staging/prod):**\n- DEV: `db:migrate` rulat local\n- CI: `db:migrate` rulat în job-ul de test cu Postgres ephemeral\n- STAGING/PROD: `db:migrate` rulat în pipeline deploy ÎNAINTE de deploy app\n\n**3. Blocare concurentă (advisory lock):**\n```typescript\n// În migration runner\nconst MIGRATION_LOCK_ID = 12345;\nawait sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID})`;\n// ... run migrations\nawait sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`;\n```\n\n**4. Script CI pentru migrații:**\n```yaml\n# În .github/workflows/deploy.yml\n- name: Run migrations\n  run: pnpm run db:migrate\n  env:\n    DATABASE_URL: ${{ secrets.DATABASE_URL_MIGRATE }}\n```",
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
        "descriere_task": "Creează serverul HTTP în apps/backend-worker (Fastify), cu routing de bază și healthcheck.\n\nCerințe minime:\n- endpoint /healthz (liveness) și /readyz (readiness)\n- graceful shutdown (SIGTERM/SIGINT)\n- server ESM-only (type: module), Node.js v24\n- config/env validation (prin pachetul de config)\n- nu expune secrete în răspunsuri",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/main.ts",
        "contextul_anterior": "F2 a stabilit data layer (PostgreSQL 18.1, Drizzle, RLS) și seed/testing.",
        "validare_task": "Pornește serverul local și verifică:\n1) GET /healthz returnează 200\n2) GET /readyz returnează 200 doar dacă dependențele minimale sunt OK\n3) La SIGTERM serverul se închide fără request-uri tăiate (graceful)",
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
    }
    ]
    ```

### F3.3: Endpoint de Webhooks (validare HMAC și enqueuing evenimente)

    ```JSON
    [
    {
        "id_task": "F3.3.1",
        "denumire_task": "Webhook ingress: raw body + validare HMAC + răspuns rapid",
        "descriere_task": "Creează endpoint-ul /api/webhooks în apps/backend-worker:\n- citește raw body (obligatoriu pentru HMAC corect - Fastify addContentTypeParser)\n- validează X-Shopify-Hmac-Sha256 cu constant-time compare\n- validează topic + shop domain\n- răspunde 200 OK rapid după validare\n- nu face procesare grea în request",
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
        "contextul_anterior": "Redis 8.4 rulează din F1.2; endpoint-ul de webhooks TREBUIE să poată enqueue din F3, nu abia în F4.",
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
        "validare_task": "Verifică în Jaeger că apare un trace pentru un request la /healthz și pentru /api/webhooks.",
        "outcome_task": "Tracing funcțional în dev înainte de pipeline-ul bulk.",
        "restrictii_antihalucinatie": "Nu bloca runtime-ul dacă exporterul e indisponibil; fallback silențios. Nu activa sampling 100% în prod by default."
    },
    {
        "id_task": "F3.4.2",
        "denumire_task": "Corelare loguri cu trace/span + request id",
        "descriere_task": "Leagă logger-ul de contextul OTel:\n- include traceId/spanId în loguri când există\n- propagate request id în atribute OTel\n- loguri structurate pentru evenimente cheie (oauth success/fail, webhook accepted/rejected)",
        "cale_implementare": "/Neanelu_Shopify/packages/logger/src/otel-correlation.ts",
        "contextul_anterior": "F3.1.4 a introdus logging; acum îl corelăm cu tracing pentru debugging end-to-end.",
        "validare_task": "Creează un request /api/webhooks și confirmă că logul conține request id și (când tracing e activ) traceId/spanId.",
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
        "contextul_anterior": "F3.3.3 a creat enqueue minim cu promisiunea de refactor în F4.1.",
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
        "denumire_task": "Semaphore/lock per shop pentru Bulk Operations (concurență 1)",
        "descriere_task": "Implementează lock distribuit pentru Bulk Operations:\n\n**Reguli:**\n- 1 bulk activ per shop la un moment dat\n- Lock cu TTL (+ renew dacă e necesar)\n- Al doilea job bulk așteaptă/delayed până lock-ul e eliberat\n\n**Redis implementation:** SETNX + TTL + Lua atomic.",
        "cale_implementare": "/Neanelu_Shopify/packages/queue-manager/src/locks",
        "contextul_anterior": "F5 va folosi acest lock pentru orchestrarea bulk operations.",
        "validare_task": "Două job-uri bulk simultane pentru același shop → al doilea așteaptă.",
        "outcome_task": "Concurrency control pentru bulk operations.",
        "restrictii_antihalucinatie": "Lock-ul nu trebuie să blocheze alte shops (aliniat cu fairness)."
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
        "descriere_task": "Expune metrici pentru cozi:\n\n**Metrici:**\n- `queue.depth` - jobs waiting per queue\n- `job.latency` - time from enqueue to start\n- `job.duration` - processing time\n- `job.retries` - retry count distribution\n- `job.failed` - failed jobs count\n- `job.stalled` - stalled jobs count\n- `ratelimit.delayed` - jobs delayed due to rate limit",
        "cale_implementare": "/Neanelu_Shopify/packages/queue-manager/src/otel",
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

## Faza F5: Pipeline-ul de ingestie „Stitched" (Săptămâna 5-6)

Durată: Săptămâna 5–6
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
        "descriere_task": "Implementează state machine-ul complet pentru Bulk Operations:\n\n**Tabele (extinde schema din F2.2):**\n```sql\n-- bulk_steps\nCREATE TABLE bulk_steps (\n  id uuid PRIMARY KEY DEFAULT uuidv7(),\n  bulk_run_id uuid REFERENCES bulk_runs(id) ON DELETE CASCADE,\n  shop_id uuid REFERENCES shops(id), -- Denormalizare pt RLS eficient\n  step_name text, -- 'download', 'parse', 'transform', 'copy'\n  status text, -- 'PENDING', 'RUNNING', 'COMPLETED', 'FAILED'\n  started_at timestamptz,\n  completed_at timestamptz,\n  error_message text\n);\n-- Integritate: Asigură consistency shop_id între bulk_runs și bulk_steps (Trigger sau validare app strictă).\nALTER TABLE bulk_steps ENABLE ROW LEVEL SECURITY;\nALTER TABLE bulk_steps FORCE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation_bulk_steps ON bulk_steps FOR ALL TO app_runtime\n  USING (shop_id = COALESCE(current_setting('app.current_shop_id', true)::uuid, '00000000-0000-0000-0000-000000000000'::uuid));\n\n-- bulk_errors\nCREATE TABLE bulk_errors (\n  id uuid PRIMARY KEY DEFAULT uuidv7(),\n  bulk_run_id uuid REFERENCES bulk_runs(id) ON DELETE CASCADE,\n  shop_id uuid REFERENCES shops(id),\n  error_type text,\n  error_message text,\n  payload jsonb, -- linia originală care a eșuat\n  created_at timestamptz DEFAULT now()\n);\n-- Security/GDPR: Payload trebuie minimizat (fără PII, doar chei). Retenție limitată (TTL/Cleanup Job).\nALTER TABLE bulk_errors ENABLE ROW LEVEL SECURITY;\nALTER TABLE bulk_errors FORCE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation_bulk_errors ON bulk_errors FOR ALL TO app_runtime\n  USING (shop_id = COALESCE(current_setting('app.current_shop_id', true)::uuid, '00000000-0000-0000-0000-000000000000'::uuid));\n\n-- bulk_artifacts\nCREATE TABLE bulk_artifacts (\n  id uuid PRIMARY KEY DEFAULT uuidv7(),\n  bulk_run_id uuid REFERENCES bulk_runs(id) ON DELETE CASCADE,\n  shop_id uuid REFERENCES shops(id),\n  artifact_type text, -- 'result' | 'partial' | 'error' | 'checkpoint'\n  url text,\n  bytes_processed bigint DEFAULT 0,\n  rows_processed bigint DEFAULT 0,\n  checksum text,\n  created_at timestamptz DEFAULT now()\n);\nALTER TABLE bulk_artifacts ENABLE ROW LEVEL SECURITY;\nALTER TABLE bulk_artifacts FORCE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation_bulk_artifacts ON bulk_artifacts FOR ALL TO app_runtime\n  USING (shop_id = COALESCE(current_setting('app.current_shop_id', true)::uuid, '00000000-0000-0000-0000-000000000000'::uuid));\n\n-- bulk_runs (extensie)\nALTER TABLE bulk_runs ADD COLUMN IF NOT EXISTS\n  operation_type text,\n  shopify_operation_id text,\n  query_type text,\n  idempotency_key text, -- NU UNIQUE global\n  cursor jsonb,\n  error_message text,\n  retry_count int DEFAULT 0;\n\n-- Partial Index pentru Idempotency (permite re-run istoric, blochează concurență activă)\nCREATE UNIQUE INDEX idx_bulk_runs_active_idempotency ON bulk_runs (shop_id, idempotency_key)\nWHERE status IN ('PENDING', 'RUNNING', 'POLLING', 'DOWNLOADING', 'PROCESSING');\n```\n\n**Path Migrații:** `packages/database/drizzle/migrations` (fără `src`)\n\n**Statusuri:** PENDING → RUNNING → POLLING → DOWNLOADING → PROCESSING → COMPLETED/FAILED/CANCELED\n\n**Idempotency:** `idempotency_key = sha256(shopId + operationType + queryType + payloadHash)`. Indexul parțial previne doar dublu-start pe job-uri active.\n\n**Resume:** La restart, preia runs cu status != COMPLETED/FAILED și continuă de la ultimul checkpoint.",
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
        "descriere_task": "Configurații pentru performance tuning:\n\n**Concurrency Limits:**\n- `MAX_CONCURRENT_DOWNLOADS = 2` per worker\n- `MAX_CONCURRENT_COPIES = 2` per shop (Aliniat F4.2)\n- `MAX_GLOBAL_INGESTION = 10` (across all shops)\n\n**Batching:**\n- COPY batch size: 10000 rows sau 50MB\n- Commit frequency: per batch (nu per row)\n\n**Index Strategy:**\n- Disable indexes on staging tables (faster insert)\n- Re-enable și REINDEX după bulk\n\n**VACUUM Plan:**\n```sql\n-- După merge\nANALYZE products;\n-- Periodic (nu la fiecare run)\nVACUUM ANALYZE products;\n```\n\n**Observabilitate:**\n- Metric: `ingestion.rows_per_second`\n- Alert: < 1000 rows/s pentru > 5 min",
        "cale_implementare": "/Neanelu_Shopify/apps/backend-worker/src/processors/bulk-operations/config.ts",
        "contextul_anterior": "Pipeline funcționează; trebuie tuning pentru 1M+ SKU.",
        "validare_task": "Benchmark cu configurații diferite; documentează optimal settings.",
        "outcome_task": "Performance tuning documented și configurable.",
        "restrictii_antihalucinatie": "NU hardcoda valori. NU omite ANALYZE."
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

## Faza F6: Integrare AI & Vector Search (Săptămâna 7)

Durată: Săptămâna 7
Obiectiv: embeddings OpenAI Batch + index vectorial în Redis 8.4 + observabilitate completă.

### F6.1: Embeddings (OpenAI Batch) + persistare (Postgres = source of truth / cold storage)

    ```JSON
    [
    {
        "id_task": "F6.1.1",
        "denumire_task": "Schema DB pentru embeddings + batch-runs (RLS, idempotency)",
        "descriere_task": "Adaugă tabele/migrații: product_embeddings (shop_id, product_id, model, dims, content_hash, embedding, generated_at, status, error), ai_batches (shop_id, provider_batch_id, status, created_at, completed_at, request_count, error_count), ai_batch_items (shop_id, batch_id, entity_id, content_hash, status, error). RLS obligatoriu pe shop_id, cu disciplina SET LOCAL din F2/F3.",
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

### F6.2: Redis 8.4 / RediSearch (vector search) + sincronizare hot cache + semantic cache

    ```JSON
    [
    {
        "id_task": "F6.2.1",
        "denumire_task": "Schema RediSearch deterministică: HNSW (Cos, M=40) + Shop Tag",
        "descriere_task": "Definește FT.CREATE cu parametri expliciți pentru reproductibilitate: HNSW (M=40, EF_CONSTRUCTION=200, DISTANCE_METRIC=COSINE). Fields: vector, product_id, updated_at, shop_id (TAG). Prefix keys: `vec:product:`.",
        "cale_implementare": "packages/ai-engine/src/vectors/redis/schema-definition.ts",
        "contextul_anterior": "Redis 8.4 cu module este prerequisite din F1.2; F0/F2 impun multi-tenant safety.",
        "validare_task": "Index creat cu parametrii specifici; o căutare fără shop_id filter este refuzată de cod.",
        "outcome_task": "Vector search corect și izolat multi-tenant.",
        "restrictii_antihalucinatie": "Nu rula vector search fără module; nu accepta căutări cross-tenant."
    },
    {
        "id_task": "F6.2.2",
        "denumire_task": "Model chei Redis + upsert/delete sync din Postgres (hot cache)",
        "descriere_task": "Definește keyspace (ex: vec:product:{shop_id}:{product_id}). Sync incremental: upsert când embedding/content_hash se schimbă, delete/tombstone când produsul e șters (aliniat cu deletes din F5 merge). Decide TTL/eviction policy pentru hot set.",
        "cale_implementare": "packages/ai-engine/src/vectors/redis/",
        "contextul_anterior": "Embeddings sunt în Postgres (F6.1); F5 definește tombstones/deletes.",
        "validare_task": "Upsert reflectă schimbările; delete scoate documentul din index; TTL nu rupe consistența (poate fi reîncărcat).",
        "outcome_task": "Redis devine hot cache consistent pentru căutare rapidă.",
        "restrictii_antihalucinatie": "Nu dubla sursa de adevăr: Postgres rămâne cold storage."
    },
    {
        "id_task": "F6.2.3",
        "denumire_task": "Worker de sincronizare către Redis (queue-based, fairness, backpressure)",
        "descriere_task": "Adaugă job-uri BullMQ Pro pentru sync embeddings în Redis (per shop group). Respectă concurrency per shop și global; aplică backpressure (dacă Redis latency crește, reduce throughput).",
        "cale_implementare": "apps/backend-worker/src/processors/ai/ + packages/queue-manager/",
        "contextul_anterior": "F4 fairness/rate limiting; F5 pipeline are knobs de performanță.",
        "validare_task": "Cu 2 shop-uri, sync e echitabil; în condiții de Redis lent, job-urile se amână controlat (nu crash).",
        "outcome_task": "Hot cache se menține actualizat fără a destabiliza sistemul.",
        "restrictii_antihalucinatie": "Nu face sync necontrolat (fără limite)."
    },
    {
        "id_task": "F6.2.4",
        "denumire_task": "Query embedding strategy + Redis Rate Limiter (Token Bucket)",
        "descriere_task": "Definește explicit cum se calculează embedding-ul interogării: remote OpenAI la request-time cu limite stricte server-side. Implementează Token Bucket în Redis (per shop) pentru a controla costurile. Evită apeluri per-keystroke (debounce UI).",
        "cale_implementare": "packages/ai-engine/src/openai/query-client.ts",
        "contextul_anterior": "Cost control și latență sunt critice.",
        "validare_task": "Rate limiter blochează excesul; debounce funcționează; fallback (ex: lexical) disponibil.",
        "outcome_task": "Căutare utilizabilă în producție, cu control de cost/latency.",
        "restrictii_antihalucinatie": "Nu bloca UI pe apeluri lente; nu chema provider la fiecare input change."
    },
    {
        "id_task": "F6.2.5",
        "denumire_task": "API vector search (topK) + fetch detalii din Postgres (RLS)",
        "descriere_task": "Endpoint/handler care: (1) obține query vector, (2) rulează FT.SEARCH KNN cu FILTER shop_id, (3) întoarce topK product_ids, (4) fetch detalii din Postgres cu RLS (SET LOCAL).",
        "cale_implementare": "apps/backend-worker/src/ + packages/ai-engine/src/vectors/redis/ + packages/database/",
        "contextul_anterior": "RLS e standard (F2/F3). Redis e doar index; datele complete sunt în Postgres.",
        "validare_task": "Rezultate corecte; latență țintă în dev; niciun leak cross-tenant.",
        "outcome_task": "Vector search end-to-end funcțional și securizat.",
        "restrictii_antihalucinatie": "Nu returna date fără verificare shop context."
    },
    {
        "id_task": "F6.2.6",
        "denumire_task": "Semantic cache (CESC) securizat + PII protection",
        "descriere_task": "Implementează cache semantic: index separat (FT.CREATE) cu `vector_field`, `query_hash_field` și `shop_id` (TAG). Stochează `sha256(normalized_text)` (NU textul raw). La query: rulează KNN cu `FILTER shop_id` obligatoriu; pe miss rulează vector search-ul principal și scrie în cache.",
        "cale_implementare": "packages/ai-engine/src/vectors/redis/semantic-cache.ts",
        "contextul_anterior": "Docs cer explicit CESC; reduce cost și latență pentru query embeddings.",
        "validare_task": "Hit rate măsurabil; respectă shop_id (izolare garantată via TAG); query text raw NU apare în Redis.",
        "outcome_task": "Cost și latență controlate pentru căutare semantică.",
        "restrictii_antihalucinatie": "Nu amesteca cache între magazine; nu stoca PII în cache keys."
    },
    {
        "id_task": "F6.2.7",
        "denumire_task": "Versionare index + rebuild safe (blue/green) la schimbare model/dims",
        "descriere_task": "Suport pentru index versioning: index_name include model+dims+versiune. Rebuild în paralel, apoi switch atomic (config). Previne downtime și corupție când schimbi modelul de embeddings.",
        "cale_implementare": "packages/ai-engine/src/vectors/redis/",
        "contextul_anterior": "Schimbarea modelului/dims este inevitabilă; trebuie plan operațional.",
        "validare_task": "Rebuild pe dataset de test; switch fără downtime; queries merg pe noul index după switch.",
        "outcome_task": "Operare enterprise fără întreruperi la upgrade AI.",
        "restrictii_antihalucinatie": "Nu reindexa in-place fără plan; nu pierde compatibilitatea."
    }
    ]
    ```

### F6.3: Observabilitate + testare + hardening (aliniat cu F4/F5)

    ```JSON
    [
    {
        "id_task": "F6.3.1",
        "denumire_task": "OTel pentru AI pipeline (spans/metrics/events, fără high-cardinality labels)",
        "descriere_task": "Instrumentează: enqueue→batch_build→batch_submit→poll→download→parse→db_upsert→redis_sync→vector_query. Metrici: ai.backlog_items, ai.batch_age_seconds, ai.items_processed_total, ai.errors_total, ai.query_latency_ms, ai.redis_sync_lag. Fără shop_domain în metric labels (shop_id doar în span attributes).",
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
        "denumire_task": "Integration tests (containers) pentru Redis RediSearch + Postgres RLS + provider mock",
        "descriere_task": "Teste end-to-end: embeddings persistate în Postgres cu RLS, sync în Redis, query KNN cu FILTER shop_id. OpenAI mock (fără dependență de serviciu extern).",
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
        "cale_implementare": "tests/performance/vector-search-load.js",
        "contextul_anterior": "Fără măsurători, 'latență mică' e doar o promisiune.",
        "validare_task": "Rulează testul în CI/staging; generează raport latență.",
        "outcome_task": "Certitudine asupra performanței înainte de producție.",
        "restrictii_antihalucinatie": "Nu ignora latența de rețea în măsurători."
    }
    ]
    ```

## Faza F7: CI/CD, Observabilitate și Producție (Săptămâna 8)

Durată: Săptămâna 8
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
    }
    ]
    ```
