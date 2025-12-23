# Research & Planificare Frontend: Neanelu Shopify Enterprise

**Data:** 23 Decembrie 2025
**Statut:** Draft pentru Decizie
**Context:** Proiect Enterprise Middleware (1M+ SKU), momentan în stadiul F0 (Bootstrapping).

---

## 1. Analiza Stării Curente (Status Quo)

În urma analizei complete a workspace-ului (`Plan_de_implementare.md`, `Docs/*`), am validat următoarele:

* **Backend & Data Layer:** Extrem de bine definite. Arhitectură clară (Postgres 18.1, Redis 8.4, BullMQ Pro), cu plan detaliat pe faze (F0-F8).
* **Frontend:** Definit sumar la nivel de stack tehnologic, dar fără un plan de execuție detaliat ("Task-level breakdown").
  * **Stack:** React Router v7 (fostul Remix), Shopify App Bridge (CDN), Polaris Web Components.
  * **Locație:** `apps/web-admin` (încă necreat).
  * **Rol:** Interfață de administrare embedded în Shopify Admin, opțională pentru funcționarea "motorului" de date, dar critică pentru vizibilitate și control.
* **Lipse Identificate:**
  * Nu există un `Plan_Frontend.md` dedicat.
  * Interacțiunea cu API-ul backend (`apps/backend-worker`) nu este specificată (Autentificare, Contract API).
  * Nu este clar cum se gestionează starea UI (Server State vs Client State) în contextul operațiunilor de lungă durată (Bulk Ops).

---

## 2. Strategii de Implementare: Matricea de Decizie

Pentru a integra frontend-ul, avem două abordări principale. Alegerea afectează direct viteza de livrare și vizibilitatea proiectului.

### Opțiunea A: Implementare Secvențială (Backend First -> Frontend Last)

Construim întregul "motor" (Faze F0-F6) și abia apoi, în Faza F7, construim interfața grafică.

| Avantaje | Dezavantaje |
| :--- | :--- |
| **Viteză maximă pe Backend:** Focus total pe integritatea datelor și algoritmica complexă (ingestie 1M SKU). | **"Black Box" timp de săptămâni:** Stakeholderii nu "văd" nimic până la final. |
| **Simplitate:** Nu schimbăm contextul între React și Node.js/SQL. | **Risc de API nepotrivit:** Putem descoperi târziu că API-ul creat nu servește bine nevoile UI-ului. |
| **Resurse:** Ideal pentru o echipă mică sau un singur developer. | **Testare întârziată:** Testarea end-to-end (click -> action) se face abia la sfârșit. |

### Opțiunea B: Implementare Paralelă (Feature-Based)

Dezvoltăm UI-ul concomitent cu funcționalitățile backend (ex: Când facem "Ingestie", facem și pagina de "Status Ingestie").

| Avantaje | Dezavantaje |
| :--- | :--- |
| **Feedback Imediat:** Vizibilitate constantă asupra progresului prin dashboard. | **Context Switching:** Efort cognitiv mare pentru a lucra full-stack simultan. |
| **API Better Design:** API-ul este validat imediat de consumatorul său real (aplicația React). | **Viteză redusă per total:** Timpul petrecut pe CSS/UI scade focusul de la problemele critice de backend (concurrency, streams). |
| **Motivație:** E mai satisfăcător să vezi o aplicație funcțională pas cu pas. | **Complexitate de Configurare:** Necesită setup complet (Proxy, Auth, CORS) din ziua 1. |

### **Recomandarea "Antigravity": Abordare Hibridă (Lagged Parallel)**

Nu blocăm complet frontend-ul, dar îl tratăm cu prioritate secundară.

1. **F0-F2 (Săptămânile 1-2):** Focus 100% Backend & Data. (Fără UI).
2. **F3 (Săptămâna 3):** Start Frontend Skeleton (Auth + Layout).
3. **F4+:** Pe măsură ce un modul backend e gata (ex: Cozi), adăugăm o pagină UI minimală de monitorizare.

---

## 3. Plan Complet de Documentare a Frontend-ului

Indiferent de strategia aleasă, trebuie să formalizăm planul frontend-ului. Propunem crearea următoarelor documente și actualizări:

### 3.1. Document Nou: `Docs/Arhitectura_Frontend_React_Router_7.md`

Va detalia:

* **Structura Proiectului:** Organizarea rutelor (`app/routes`), componentelor și utilitarelor în `apps/web-admin`.
* **Integrare Shopify:** Setup `shopify-app-react-router`, gestionarea Session Token, comunicarea cu App Bridge.
* **Data Fetching:** Utilizarea `loader` / `action` din React Router v7 vs React Query (TanStack Query) pentru stări asincrone complexe (ex: polling status joburi).
* **Design System:** Ghid de utilizare Polaris Web Components (cum folosim `<s-card>`, `<s-resource-list>` în React).

### 3.2. Actualizare: `Plan_de_implementare.md`

Vom insera task-uri specifice de Frontend în fazele existente (pentru strategia Paralelă) sau într-o fază nouă dedicată (pentru Secvențial).

* *Exemplu inserție F3:* "F3.5: Setup Frontend Base - Inițializare React Router, Configurare Vite Proxy, Auth Wrapper".

### 3.3. Document Nou: `Docs/Ghid_Dezvoltare_UI.md`

* Standarde de cod React (Hooks, Components).
* Strategia de testare cu Vitest (Unit) și Playwright (E2E - opțional).

---

## 4. Acțiuni Imediate (Next Steps)

1. **Aprobare Decizie:** Alegeți strategia (Secvențial vs Paralel vs Hibrid).
2. **Execuție Documentare:** Pe baza deciziei, voi genera `Docs/Arhitectura_Frontend_React_Router_7.md` și voi actualiza `Plan_de_implementare.md`.
