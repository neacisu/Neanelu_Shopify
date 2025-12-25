# Arhitectura Frontend Detaliată: Neanelu Shopify Enterprise (Vite 7.3 + RR7)

**Data:** 23 Decembrie 2025
**Nivel Detaliu:** Exhaustiv (UI/UX Elements, Copy, States)
**Stack:** Vite 7.3, React Router v7, Polaris Web Components 2025-10, Tailwind v4, Lucide React Icons 0.562.0

---

## 1. Global UI Elements & Feedback

Elemente disponibile în `root.tsx` și accesibile global.

### A. Notificări (Toaster - `sonner`)

* **Success Toast:**
  * *Icon:* `CheckCircle` (Green-500)
  * *Duration:* 4000ms
  * *Exemplu Mesaj:* "Operațiune reușită - Jobul #123 a fost repornit."
* **Error Toast:**
  * *Icon:* `AlertCircle` (Red-500)
  * *Variant:* `destructive` (Fundal roșu deschis / Border roșu)
  * *Action:* Buton "Retry" (opțional)
  * *Exemplu Mesaj:* "Eroare de conexiune. Backend-ul nu răspunde (503)."
* **Info Toast:**
  * *Icon:* `Info` (Blue-500)
  * *Mesaj:* "Sincronizare în curs... Te rugăm să aștepți."

### B. Dialoguri de Confirmare (`AlertDialog`)

Standard pentru acțiuni distructive (Delete, Abort).

* **Header:** "Această acțiune este ireversibilă."
* **Buttons:**
  * Cancel: "Renunță" (Ghost variant)
  * Confirm: "Șterge definitiv" (Destructive variant, Red BG)

### C. Loading States (`Skeleton`)

* **Page Load:** `Skeleton` dreptunghiular mare pentru header + 3 rânduri `Skeleton` pentru tabele.
* **Button Action:** Spinner (`Loader2` animate-spin) înlocuiește icon-ul butonului. Textul devine "Procesare...".

---

## 2. Pagina: Dashboard Principal (`_index.tsx`)

### Header

* **Title (`h1`):** "Neanelu Monitor"
* **Subtitle (`p`):** "System Overview & Health Status"
* **Action Button:**
  * *Label:* "Refresh Data"
  * *Icon:* `RefreshCw`
  * *Behavior:* Revalidează toți loaderii. Animație spin 1s.

### Secțiunea 1: KPI Grid (4 Cards)

Fiecare card are: Titlu (text-muted), Valoare (text-2xl bold), Icon (dreapta-sus), Indicator Trend (jos).

1. **Card: Produse Totale**
    * *Icon:* `Package`
    * *Valoare:* ex. "1,024,500"
    * *Subtext:* "+150 azi" (Verde)
2. **Card: Cozi Active**
    * *Icon:* `Cpu`
    * *Valoare:* ex. "45 Jobs"
    * *Subtext:* "Processing speed: 12/s"
3. **Card: System Health**
    * *Icon:* `Activity`
    * *Valoare:* "Operational" (Text Verde) sau "Degraded" (Text Galben)
    * *Subtext:* "Redis Latency: 4ms"
4. **Card: Rata Erori**
    * *Icon:* `AlertTriangle`
    * *Valoare:* "0.02%"
    * *Subtext:* "Target < 0.1%"

### Secțiunea 2: Recent Activity Table

* **Title:** "Jurnal Activitate Recentă"
* **Empty State:** Imagine `ClipboardList` gri, Text "Nicio activitate înregistrată în ultimele 24h".
* **Columns:**
    1. **Event:** Nume eveniment (ex: "Bulk Sync", "Price Update"). *Bold*.
    2. **Type:** `Badge` (Blue="System", Purple="User", Orange="Shopify").
    3. **Status:** `StatusBadge` (Green="Success", Red="Failed", Yellow="Running").
    4. **Time:** "acum 2 min" (format relativ).
    5. **Actions:** Buton `...` (Dropdown -> "View Logs").

---

## 3. Pagina: Queue Monitor (`app.queues.tsx`)

### Layout

* **Tabs List:**
  * Tab 1: "Metrici & Performanță"
  * Tab 2: "Lista Joburi"
  * Tab 3: "Workeri Activi"

### Tab 1: Metrici (Charts)

* **Grafic Throughput (Line Chart):**
  * *X-Axis:* Timp (HH:mm)
  * *Y-Axis:* Jobs/sec
  * *Tooltip:* "14:30 - 35 jobs/sec"
  * *Reference Line:* Linie roșie la 50 jobs/sec (Max Limit).
* **Grafic Stare (Pie Chart):**
  * Distribuția joburilor: Active (Albastru), Waiting (Galben), Failed (Roșu), Completed (Verde).

### Tab 2: Lista Joburi (Data Table)

* **Toolbar:**
  * **Search Input:** Placeholder="Caută după Job ID...", Icon=`Search`.
  * **Filter Select:** "Toate Statusurile", "Doar Erori", "În așteptare".
  * **Button:** "Retry Failed (Bulk)" - Activ doar dacă există joburi failed.
* **Table Columns:**
    1. **ID:** Monospace font (ex: `bull:work:123...`). Copy-to-clipboard on click.
    2. **Data:** Componentă cu 2 linii (Sus: Nume Job, Jos: Payload preview trunchiat).
    3. **Progress:** `Progress` bar mic (dacă e activ).
    4. **Attempts:** "1/3" (Badge variant="outline").
    5. **Actions:**
        * *Retry:* Repornește jobul imediat.
        * *Promote:* Mută din Delayed în Waiting.
        * *Logs:* Deschide `Dialog` cu stack trace.
        * *Delete:* Deschide `AlertDialog`.

### Tab 3: Workeri

* **Grid Cards:** Fiecare worker e un card mic.
* **Content:**
  * Header: "Worker #01" (Verde=Online, Gri=Offline).
  * Body: "Processing: Job #8821" sau "Idle".
  * Footer: "CPU: 45% | MEM: 200MB".

---

## 4. Pagina: Ingestie Bulk (`app.ingestion.tsx`)

### State: Idle (Nicio operatiune)

* **Hero Section:**
  * Title: "Pregătit pentru Ingestie"
  * Description: "Ultima sincronizare completă: 22 Dec 2025."
  * **Primary Button:** "Start Full Sync" (Declanșează `bulkOperationRunQuery`).
  * **Secondary Area:** Dropzone ("Trage un fișier JSONL aici pentru test manual").

### State: Active (În timpul procesării)

* **Status Card:**
  * Title: "Sincronizare în curs..."
  * Animatie: Pulse effect pe border.
  * **Main Progress Bar:** Lățime 100%, înălțime 24px, text interior "45%".
* **Steps Indicator (Stepper):**
    1. **Download:** Icon `DownloadCloud` (Completed).
    2. **Parse JSONL:** Icon `FileJson` (Active - animate spin).
    3. **Transform:** Icon `Cpu` (Waiting).
    4. **DB Insert:** Icon `Database` (Waiting).
* **Live Metrics:** "Viteză curentă: 12,500 rânduri/sec".
* **Emergency Button:** "Abort Operation" (Roșu).

### Componenta: Log Console

* **Header:** "Console Output" + Toggle "Show Errors Only".
* **Body:** Fundal negru (`bg-slate-950`), text monospace (`font-mono text-xs`).
* **Line Formatting:**
  * `[INFO]`: Text gri (`text-slate-400`).
  * `[WARN]`: Text galben (`text-amber-400`).
  * `[ERROR]`: Text roșu (`text-red-400`).

---

## 5. Pagina: AI Search Playground (`app.search.tsx`)

### Sidebar (Stânga - 300px)

* **Panel Title:** "Parametri Căutare"
* **Input:** Textarea "Query Text" (rows=3, placeholder="Descrie produsul... ex: pantofi alergare roșii").
* **Label:** "Similarity Threshold"
  * *Slider:* Range 0.1 - 1.0. Step 0.05.
  * *Value Display:* "0.85" (dreapta).
* **Limit:** Input number "Max Results" (Default: 10).
* **Switch:** "Include Metadata" (arată JSON brut).
* **Button:** "Execută Căutare" (W-full, Blue).

### Results Grid (Dreapta)

* **Empty State:** "Introdu un query și apasă Caută."
* **Card Produs:**
  * *Image:* Thumbnail stânga (pătrat 80px, object-cover).
  * *Content:*
    * Title: Trunchiat la 2 rânduri.
    * Price: Bold.
  * *Footer (Technical):*
    * Badge "Score: 0.92" (Verde > 0.9, Galben > 0.7).
    * Badge "Vector ID: 123...".
* **JSON Modal:** Click pe card deschide un `Dialog` cu JSON-ul complet al vectorului/produsului.

---

## 6. Componente UI (Polaris Web Components 2025-10 setup)

Primitivele care vor fi instalate și customizate în `apps/web-admin/components/ui/`:

1. **Button:** Variants (default, destructive, outline, secondary, ghost, link).
2. **Badge:** Variants (default, secondary, destructive, outline).
3. **Card:** Header, Title, Description, Content, Footer.
4. **Input / Textarea / Select:** Form elements cu focus ring.
5. **Table:** Header, Body, Row, Cell, Caption.
6. **Progress:** Indicator loading.
7. **Dialog / AlertDialog:** Modale.
8. **Tabs:** List, Trigger, Content.
9. **Skeleton:** Loading placeholders.
10. **Tooltip:** Hover info.
11. **ScrollArea:** Pentru Log Console.
12. **Toast:** Notificări.
