# Strategie de Dezvoltare: Menu/Category Bulk Operations (Shopify)

## 1. Context și Obiective

**Scop**: Implementarea unei soluții software custom (TypeScript/Node.js) capabile să gestioneze un meniu de navigare Shopify ("Mega Menu") cu un volum mare de date (2000+ categorii și subcategorii nested), depășind limitările interfeței manuale și asigurând integritatea datelor.

**Provocare Principală**: Gestionarea a 2000+ itemi respectând limitele API-ului Shopify, rata de apeluri (Rate Limits) și restricția structurală de maxim 3 niveluri de nesting.

**Aliniere cu Infrastructura Existentă**:
Strategia va refolosi pattern-urile de conectivitate și utilitarele TypeScript deja validate în cadrul proiectului "Research Produse" (`/var/www/Neanelu_Shopify/Research Produse/Scripts/TScripts`).

---

## 2. Research & Findings (Dec 2025)

În urma analizei initiale și a execuției scripturilor de audit, s-au stabilit următoarele realități tehnice cruciale pentru implementare:

### A. Schema API 2025-10 și Limitări Structurale

* **Obiectul `MenuItem` Lightweight**: În versiunea actuală a API-ului, obiectul `MenuItem` **NU** expune direct proprietățile resursei legate (ex: `productsCount` pentru o colecție, `status` pentru un produs) și nici `metafields`.
* **Soluția în 2 Pași**: Pentru orice operațiune de audit sau validare, este necesară o abordare în doi pași:
    1. Fetch la structura meniului (care oferă `resourceId`).
    2. Bulk Query (`nodes(ids: [...])`) pentru a rezolva detaliile resurselor.

### B. Vizibilitatea "Online Store"

* **Discrepanța API vs Storefront**: Un produs sau o colecție poate fi validă în API (`Active`, `Published`), dar invizibilă pe site dacă nu este publicată specific pe canalul "Online Store".
* **Limitare App Token**: Token-ul de Admin API folosit nu are acces la contextul "Sales Channel" al Online Store, deci interogarea câmpului `publishedOnCurrentPublication` returnează eroare.
* **Soluție Detecție**: Singura metodă viabilă de a detecta produse "fantomă" (importate dar neafișate) este verificarea câmpului `availablePublicationsCount` (dacă este 0, produsul e invizibil peste tot) sau corelarea manuală cu exporturi de produse.

### C. Starea Meniului Current (Audit Dec 2025)

* **Volum**: ~600 itemi în "Categorii Produse" (Mega Menu).
* **Sănătate**: S-au identificat ~200 itemi problematici (majoritatea colecții goale sau link-uri spre resurse șterse).
* **Concluzie**: Înainte de a migra la un sistem automatizat de management, este necesară o curățare a datelor ("Data Cleanup").

---

## 3. Arhitectura Tehnică & Conectivitate

### A. Environment & Auth

Vom utiliza aceleași credențiale și fișier de mediu ca și scripturile de research produse.

* **Env File Path**: `/var/www/Neanelu_Shopify/Research Produse/.env.txt`
* **Variabile necesare**:
  * `SHOPIFY_SHOP_DOMAIN` (ex: `neanelu.myshopify.com` sau custom domain)
  * `SHOPIFY_ADMIN_API_TOKEN` (Format: `shpat_...`)

### B. Stack Tehnologic Adaptat

* **Limbaj**: TypeScript (Node.js v20+).
* **Client API**: Vom refolosi funcția `gqlPost` din [`common.ts`](/var/www/Neanelu_Shopify/Research%20Produse/Scripts/TScripts/common.ts) care implementează deja un client `https` lightweight cu suport pentru timeout și headers custom.
* **Paginare & Helpers**: Adaptare logica din `fetch_shopify_products.ts` pentru paginarea resurselor nested (deși meniurile au o structură diferită, principiul `nodes` + `pageInfo` rămâne valabil pentru bulk queries conexe).

### C. Versiune API

* **Target**: **Admin GraphQL API 2025-10** (sau cea mai recentă stabilă `2026-01` dacă este disponibilă la momentul execuției).
* *Motivație*: Aliniere cu scriptul `fetch_shopify_products.ts` care folosește deja `2025-10`. Aceasta oferă suportul complet pentru `menu*` mutations și error handling granular.

---

## 4. Arhitectura "Diff & Patch"

Abordarea rămâne una "chirurgicală" pentru a minimiza riscul și consumul de API.

1. **Snapshot (Read)**: Citirea stării curente folosind `gqlPost` cu un query recursiv limitat.
2. **Definition (Read)**: Starea dorită (Local State) definită într-un JSON/TS structurat.
3. **Diff Engine**:
    * Identificare noduri de șters (`Obsolete`).
    * Identificare noduri de creat (`New`).
    * Identificare noduri de actualizat (`Modified`: titlu, link, ordine).
4. **Patch Execution**: Execuție secvențială a mutațiilor.

---

## 5. Workflow Detaliat

### Pasul 1: Setup & Conectare

Scriptul va începe prin încărcarea mediului folosind funcția `loadEnvFile` din `common.ts`.

```typescript
// Exemplu reutilizare
import { loadEnvFile, gqlPost } from '../Research Produse/Scripts/TScripts/common.js';
const env = loadEnvFile('/var/www/Neanelu_Shopify/Research Produse/.env.txt');
const endpoint = `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/2025-10/graphql.json`;
```

### Pasul 2: Backup (Safety First)

* **Query**: Obține toți itemii meniului țintă (`handle: "main-menu"`).
* **Stocare**: Salvează JSON-ul brut în `/var/www/Neanelu_Shopify/Research Categorii/CatOutputs/backups/`.
* *Nota*: Deși API-ul de Meniuri nu are paginare tip "cursor" adâncă pentru itemi (returnează arborele), pentru 2000 itemi s-ar putea să fie nevoie de fragmentare dacă query-ul dă timeout. Soluția este fetch pe nivele (Level 1 -> Level 2 -> Level 3).

### Pasul 3: Calculul Diferențelor

Se va implementa un comparator care ignoră ID-urile interne Shopify pentru nodurile noi, dar le folosește pentru cele existente.

* **Matching**: Se face pe baza `resourceId` (pentru colecții/produse) sau `url` (pentru link-uri custom), plus `title`.

### Pasul 4: Execuția Mutațiilor

Din cauza rate limitelor (Leaky Bucket), nu putem paraleli excesiv scrierile.

* **Throttle**: Vom implementa o pauză (`sleep(100)` ms) între mutații, similar cu `fetch_shopify_products.ts`.
* **Retry**: Adăugarea unei logici de retry în cazul erorilor `THROTTLED` (cod 429), care momentan lipsește din `gqlPost` (acesta doar aruncă eroare). Se va extinde `gqlPost` sau se va face un wrapper `gqlMutate`.

---

## 6. Detalii Implementare (Specifice API 2025-10)

### Mutații Esențiale

* **`menuItemCreate`**: Necesită `menuId` și opțional `parentId`.
* **`menuItemUpdate`**: Necesită `id` (al itemului).
* **`menuItemDelete`**: Necesită `id`.

**Structura de input propusă (Local Definition):**

```typescript
interface MenuNode {
  title: string;
  type: 'HTTP' | 'COLLECTION' | 'PRODUCT' | 'PAGE';
  resourceId?: string; // ex: gid://shopify/Collection/12345
  url?: string;
  items?: MenuNode[]; // Children
  // Metadata pentru diffing
  _existingId?: string; // Populat după fetch-ul inițial dacă există potrivire
}
```

---

## 7. Limitări și Soluții

### A. Nesting Limit (Max 3 Levels)

Algoritmul de validare din script va parcurge arborele local *înainte* de orice call API și va arunca eroare dacă adâncimea > 3, prevenind fail-uri parțiale în timpul execuției.

### B. Referințe Invalide (Dangling Links)

Scriptul va avea un pas opțional `--verify-refs` care interoghează rapid (via `nodes` query) dacă `resourceId`-urile din definiția locală mai există în Shopify.

---

## 8. Plan de Acțiune (Actualizat)

1. **[COMPLETED] Setup & Utilitare**: Clonare `common.ts` și configurare mediu.
2. **[COMPLETED] Script Fetch/Backup**: Implementat `fetch_menu_jsonl.ts` (Tree & Flat support).
3. **[COMPLETED] Audit Menu**: Implementat `audit_menu.ts` și `resolve_audit_references.ts` pentru deep inspection.
4. **[NEXT] Data Cleanup**: Analiza raportului de audit și decizia asupra itemilor invalizi (ștergere vs reparare).
5. **Script Diff Engine**: Dezvoltarea comparatorului de stare (Local vs Remote).
6. **Script Sync/Patch**: Implementarea scrierii (Mutations: Create/Update/Delete).
7. **Pilot Test**: Rulare pe un meniu izolat.
