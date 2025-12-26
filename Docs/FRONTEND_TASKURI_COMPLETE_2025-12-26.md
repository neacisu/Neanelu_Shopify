# 📋 TASKURI COMPLETE FRONTEND - NEANELU Shopify Enterprise

> **Data:** 26 Decembrie 2025  
> **Versiune:** 1.0 - COMPREHENSIVE  
> **Format:** JSON (compatibil cu Plan_de_implementare.md)

---

## Legendă Prioritate

| Tag | Descriere |
|-----|-----------|
| P0 | BLOCKER - Fără aceasta, aplicația nu funcționează |
| P1 | CRITICAL - Funcționalitate de bază |
| P2 | IMPORTANT - Enhancement esențial |
| P3 | NICE-TO-HAVE - Polish, delighters |

---

## FAZA FE1: Design System & Foundation Enhancement

### FE1.1: Design System Avansat

```JSON
[
{
    "id_task": "FE1.1.1",
    "denumire_task": "Design Tokens 2.0 - Paleta de Culori Enterprise",
    "descriere_task": "Extinde design tokens cu paletă profesională:\n\n**Culori Brand:**\n- Primary: Deep Ocean Blue (#0A2540) - Trust, Enterprise\n- Secondary: Electric Violet (#5B5FC7) - Innovation, AI\n- Accent: Coral Energy (#FF6B6B) - Actions, Alerts\n\n**Semantic Colors:**\n- Success: Mint Fresh (#10B981)\n- Warning: Amber Glow (#F59E0B)\n- Error: Rose (#EF4444)\n- Info: Sky (#0EA5E9)\n\n**Neutrals (Slate scale):**\n- 50 → 950 pentru backgrounds, text, borders\n\n**CSS Variables:**\n```css\n:root {\n  --color-primary: 10 37 64;\n  --color-secondary: 91 95 199;\n  --color-accent: 255 107 107;\n}\n```",
    "cale_implementare": "/apps/web-admin/tailwind.config.ts, /apps/web-admin/app/globals.css",
    "contextul_anterior": "F3.5.0.1 definește tokens basic. Enhancement pentru look premium.",
    "validare_task": "Toate componentele folosesc CSS variables. Dark mode funcționează cu inversare corectă.",
    "outcome_task": "Identitate vizuală distinctivă, profesională.",
    "restrictii_antihalucinatie": "NU folosesc culori hardcodate. TOATE valorile din design tokens.",
    "prioritate": "P0"
},
{
    "id_task": "FE1.1.2",
    "denumire_task": "Typography System Premium",
    "descriere_task": "Configurare tipografie distinctivă:\n\n**Font Families:**\n- Display: 'Plus Jakarta Sans' (headings) - Modern, geometric\n- Body: 'Inter Variable' (text) - Optimal readability\n- Mono: 'JetBrains Mono' (code, IDs) - Developer-friendly\n\n**Type Scale (rem):**\n- display-xl: 3rem/1.1\n- display-lg: 2.25rem/1.2\n- h1: 1.875rem/1.3\n- h2: 1.5rem/1.4\n- h3: 1.25rem/1.5\n- body: 1rem/1.6\n- caption: 0.875rem/1.5\n- micro: 0.75rem/1.4\n\n**Font Loading:**\n- `font-display: swap` pentru performance\n- Preload critical fonts în head",
    "cale_implementare": "/apps/web-admin/app/globals.css, /apps/web-admin/public/fonts/",
    "contextul_anterior": "Design tokens de bază există.",
    "validare_task": "Fonts se încarcă fără layout shift. Type scale aplicat consistent.",
    "outcome_task": "Tipografie premium care diferențiază aplicația.",
    "restrictii_antihalucinatie": "NU folosesc system fonts ca fallback principal - DEFINIM explicit.",
    "prioritate": "P1"
},
{
    "id_task": "FE1.1.3",
    "denumire_task": "Shadow & Elevation System",
    "descriere_task": "Sistem de umbre pentru depth hierarchy:\n\n**Elevation Levels:**\n```css\n--shadow-xs: 0 1px 2px rgba(0,0,0,0.05);\n--shadow-sm: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06);\n--shadow-md: 0 4px 6px -1px rgba(0,0,0,0.1);\n--shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.1);\n--shadow-xl: 0 20px 25px -5px rgba(0,0,0,0.1);\n--shadow-inner: inset 0 2px 4px rgba(0,0,0,0.06);\n```\n\n**Usage Guidelines:**\n- Cards resting: shadow-sm\n- Cards hover: shadow-md (transition)\n- Modals: shadow-xl\n- Dropdowns: shadow-lg\n- Inputs focus: ring + shadow-sm",
    "cale_implementare": "/apps/web-admin/tailwind.config.ts",
    "contextul_anterior": "Tailwind config există.",
    "validare_task": "Hover pe cards arată transition vizibil. Modals au depth evident.",
    "outcome_task": "Visual hierarchy clară prin shadows.",
    "restrictii_antihalucinatie": "NU exagera cu shadows - subtle is better.",
    "prioritate": "P2"
}
]
```

### FE1.2: Animation & Motion System

```JSON
[
{
    "id_task": "FE1.2.1",
    "denumire_task": "Motion Design Tokens",
    "descriere_task": "Definire timing și easing pentru animații consistente:\n\n**Durations:**\n```css\n--duration-instant: 75ms;\n--duration-fast: 150ms;\n--duration-normal: 300ms;\n--duration-slow: 500ms;\n--duration-slower: 700ms;\n```\n\n**Easings:**\n```css\n--ease-in: cubic-bezier(0.4, 0, 1, 1);\n--ease-out: cubic-bezier(0, 0, 0.2, 1);\n--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);\n--ease-spring: cubic-bezier(0.175, 0.885, 0.32, 1.275);\n```\n\n**Tailwind Extend:**\n```js\ntransitionDuration: { instant: '75ms', fast: '150ms', normal: '300ms' }\ntransitionTimingFunction: { spring: 'var(--ease-spring)' }\n```",
    "cale_implementare": "/apps/web-admin/tailwind.config.ts, /apps/web-admin/app/globals.css",
    "contextul_anterior": "Design tokens pentru culori exist.",
    "validare_task": "Toate animațiile folosesc variabilele definite. Consistență vizuală.",
    "outcome_task": "Motion design system profesional.",
    "restrictii_antihalucinatie": "Respectă prefers-reduced-motion pentru accessibility.",
    "prioritate": "P1"
},
{
    "id_task": "FE1.2.2",
    "denumire_task": "Page Transition Animations",
    "descriere_task": "Implementare tranziții smooth între pagini:\n\n**Pattern:**\n```tsx\n// În root.tsx\nimport { motion, AnimatePresence } from 'framer-motion';\n\nconst pageVariants = {\n  initial: { opacity: 0, y: 10 },\n  in: { opacity: 1, y: 0 },\n  out: { opacity: 0, y: -10 }\n};\n\n<AnimatePresence mode='wait'>\n  <motion.div\n    key={location.pathname}\n    variants={pageVariants}\n    initial='initial'\n    animate='in'\n    exit='out'\n    transition={{ duration: 0.2 }}\n  >\n    <Outlet />\n  </motion.div>\n</AnimatePresence>\n```\n\n**Dependencies:** framer-motion@latest",
    "cale_implementare": "/apps/web-admin/app/root.tsx, /apps/web-admin/app/components/layout/PageTransition.tsx",
    "contextul_anterior": "React Router v7 funcționează.",
    "validare_task": "Navigarea între pagini are fade + slide subtle. Nu blochează interacțiunea.",
    "outcome_task": "Experiență premium la navigare.",
    "restrictii_antihalucinatie": "NU bloca navigarea cu animații lungi. Max 300ms.",
    "prioritate": "P2"
},
{
    "id_task": "FE1.2.3",
    "denumire_task": "Micro-interactions Library",
    "descriere_task": "Biblioteca de micro-animații reutilizabile:\n\n**Button Interactions:**\n```tsx\n// Scale down on press\nconst buttonTap = { scale: 0.97, transition: { duration: 0.1 } };\n\n// Loading state\nconst buttonLoading = {\n  icon: <Loader2 className='animate-spin' />,\n  text: 'Processing...'\n};\n```\n\n**Card Interactions:**\n```css\n.card-interactive {\n  transition: transform 150ms ease, box-shadow 150ms ease;\n}\n.card-interactive:hover {\n  transform: translateY(-2px);\n  box-shadow: var(--shadow-md);\n}\n```\n\n**Success Animation:**\n- Checkmark draw SVG (400ms)\n- Scale bounce (spring easing)\n\n**Error Shake:**\n```css\n@keyframes shake {\n  0%, 100% { transform: translateX(0); }\n  25% { transform: translateX(-5px); }\n  75% { transform: translateX(5px); }\n}\n```",
    "cale_implementare": "/apps/web-admin/app/components/ui/animations/",
    "contextul_anterior": "Motion tokens definiți.",
    "validare_task": "Click pe button arată scale. Error form arată shake. Success arată checkmark.",
    "outcome_task": "Feedback vizual instantaneu pentru toate acțiunile.",
    "restrictii_antihalucinatie": "NU anima TOT - doar interactive elements și feedback.",
    "prioritate": "P2"
},
{
    "id_task": "FE1.2.4",
    "denumire_task": "Skeleton Loading Animations",
    "descriere_task": "Skeleton screens pentru toate loading states:\n\n**Components:**\n1. `SkeletonText` - linii de text cu width variabil\n2. `SkeletonCard` - card complet cu image + text placeholders\n3. `SkeletonTable` - rows pentru data tables\n4. `SkeletonKPI` - KPI card skeleton\n5. `SkeletonChart` - chart area skeleton\n\n**Animation:**\n```css\n.skeleton {\n  background: linear-gradient(90deg, \n    var(--color-muted) 0%, \n    var(--color-muted-light) 50%, \n    var(--color-muted) 100%);\n  background-size: 200% 100%;\n  animation: shimmer 1.5s infinite;\n}\n@keyframes shimmer {\n  0% { background-position: 200% 0; }\n  100% { background-position: -200% 0; }\n}\n```",
    "cale_implementare": "/apps/web-admin/app/components/ui/skeleton/",
    "contextul_anterior": "Loading states menționate în doc.",
    "validare_task": "Fiecare pagină are skeleton corespunzător structurii. Shimmer animation smooth.",
    "outcome_task": "Perceived performance mult îmbunătățită.",
    "restrictii_antihalucinatie": "Skeleton TREBUIE să matching layout-ul real pentru a evita layout shift.",
    "prioritate": "P1"
}
]
```

---

## FAZA FE2: Core Components Complete

### FE2.1: Data Display Components

```JSON
[
{
    "id_task": "FE2.1.1",
    "denumire_task": "DataTable Component - Full Featured",
    "descriere_task": "Componentă tabel avansată cu toate funcționalitățile:\n\n**Features:**\n- Sorting (click header, multi-column)\n- Filtering (column filters, global search)\n- Pagination (configurable page sizes)\n- Row selection (single/multi)\n- Column resizing (drag)\n- Column visibility toggle\n- Sticky header\n- Row virtualization (pentru 1000+ rows)\n\n**Props Interface:**\n```typescript\ninterface DataTableProps<T> {\n  data: T[];\n  columns: ColumnDef<T>[];\n  loading?: boolean;\n  pagination?: { page: number; pageSize: number; total: number };\n  onPageChange?: (page: number) => void;\n  onSort?: (column: string, direction: 'asc' | 'desc') => void;\n  onRowSelect?: (rows: T[]) => void;\n  onRowClick?: (row: T) => void;\n  emptyState?: ReactNode;\n  toolbar?: ReactNode;\n}\n```\n\n**Base:** @tanstack/react-table v8",
    "cale_implementare": "/apps/web-admin/app/components/ui/data-table/",
    "contextul_anterior": "Table menționat în Polaris setup.",
    "validare_task": "Sort pe coloană funcționează. Pagination afișează corect. Row select pentru bulk actions.",
    "outcome_task": "Tabel production-ready pentru toate listele de date.",
    "restrictii_antihalucinatie": "NU reinventăm roata - folosim TanStack Table. Virtualization OBLIGATORIU pentru >500 rows.",
    "prioritate": "P0"
},
{
    "id_task": "FE2.1.2",
    "denumire_task": "VirtualizedList Component (1M+ items)",
    "descriere_task": "Listă virtualizată pentru volume mari de date:\n\n**Features:**\n- Render doar items vizibile (window)\n- Dynamic item heights support\n- Infinite scroll (load more on scroll)\n- Scroll to item by index/id\n- Keyboard navigation\n\n**Implementation:**\n```typescript\nimport { useVirtualizer } from '@tanstack/react-virtual';\n\nconst VirtualizedList = ({ items, renderItem, estimateSize }) => {\n  const parentRef = useRef(null);\n  const virtualizer = useVirtualizer({\n    count: items.length,\n    getScrollElement: () => parentRef.current,\n    estimateSize: () => estimateSize,\n    overscan: 5\n  });\n  // ...\n};\n```",
    "cale_implementare": "/apps/web-admin/app/components/ui/virtualized-list.tsx",
    "contextul_anterior": "Aplicația gestionează 1M+ produse.",
    "validare_task": "Render 10,000 items fără lag. Scroll smooth. Memory stable.",
    "outcome_task": "Performance pentru liste mari.",
    "restrictii_antihalucinatie": "NU încărcăm toate datele în DOM - DOAR visible window.",
    "prioritate": "P0"
},
{
    "id_task": "FE2.1.3",
    "denumire_task": "JsonViewer Component",
    "descriere_task": "Viewer JSON cu syntax highlighting și collapse:\n\n**Features:**\n- Syntax highlighting (string: green, number: blue, etc.)\n- Collapsible nodes (click to expand/collapse)\n- Copy to clipboard (node sau întreg JSON)\n- Search within JSON\n- Line numbers\n- Formatted vs compact toggle\n\n**Props:**\n```typescript\ninterface JsonViewerProps {\n  data: object | string;\n  collapsed?: number; // depth to collapse\n  theme?: 'light' | 'dark';\n  onCopy?: (path: string, value: any) => void;\n  maxHeight?: string;\n}\n```",
    "cale_implementare": "/apps/web-admin/app/components/ui/json-viewer.tsx",
    "contextul_anterior": "F5.2 produce JSONL pentru viewing.",
    "validare_task": "JSON mare se afișează fără lag. Collapse funcționează. Copy funcționează.",
    "outcome_task": "Debugging ușor pentru date JSON.",
    "restrictii_antihalucinatie": "Folosește virtualization pentru JSON foarte mari (>1000 keys).",
    "prioritate": "P1"
},
{
    "id_task": "FE2.1.4",
    "denumire_task": "Timeline Component",
    "descriere_task": "Componentă timeline pentru activități/evenimente:\n\n**Features:**\n- Vertical layout cu linie de conectare\n- Icon per event type (success/error/info/warning)\n- Timestamp formatting (relative + absolute)\n- Expandable details per event\n- Load more pagination\n- Filter by type\n\n**Structure:**\n```tsx\n<Timeline>\n  <TimelineItem\n    icon={<CheckCircle />}\n    status='success'\n    title='Sync Completed'\n    timestamp={date}\n    description='Processed 1,234 products'\n  />\n</Timeline>\n```",
    "cale_implementare": "/apps/web-admin/app/components/ui/timeline.tsx",
    "contextul_anterior": "Audit logs și activitate necesită afișare cronologică.",
    "validare_task": "Timeline afișează events corect. Expand funcționează. Icons corecte.",
    "outcome_task": "Vizualizare intuitivă a activităților.",
    "restrictii_antihalucinatie": "NU încărcăm toate events - paginare cu 'Load More'.",
    "prioritate": "P1"
},
{
    "id_task": "FE2.1.5",
    "denumire_task": "TreeView Component",
    "descriere_task": "Componentă arbore pentru structuri ierarhice:\n\n**Use Cases:**\n- Product categories\n- File/folder navigation\n- Taxonomy display\n- Metafield groups\n\n**Features:**\n- Expand/collapse nodes\n- Icons per node type\n- Drag & drop reorder (optional)\n- Multi-select\n- Search/filter\n- Lazy loading children\n\n**Props:**\n```typescript\ninterface TreeViewProps<T> {\n  data: TreeNode<T>[];\n  renderNode: (node: T) => ReactNode;\n  onSelect?: (node: T) => void;\n  onExpand?: (node: T) => void;\n  selectedIds?: string[];\n}\n```",
    "cale_implementare": "/apps/web-admin/app/components/ui/tree-view.tsx",
    "contextul_anterior": "PIM are categorii ierarhice.",
    "validare_task": "Expand/collapse funcționează. Selection funcționează. Large trees performante.",
    "outcome_task": "Navigare intuitivă în structuri ierarhice.",
    "restrictii_antihalucinatie": "Lazy load children pentru arbori mari.",
    "prioritate": "P2"
}
]
```

### FE2.2: Chart Components

```JSON
[
{
    "id_task": "FE2.2.1",
    "denumire_task": "Charts Library Setup (Recharts)",
    "descriere_task": "Instalare și configurare bibliotecă charts:\n\n**Package:** recharts@latest\n\n**Theme Integration:**\n```typescript\nconst chartTheme = {\n  colors: [\n    'var(--color-primary)',\n    'var(--color-secondary)',\n    'var(--color-accent)',\n    'var(--color-success)'\n  ],\n  grid: { stroke: 'var(--color-border)' },\n  text: { fill: 'var(--color-muted-foreground)' }\n};\n```\n\n**Components Setup:**\n- ResponsiveContainer wrapper\n- Tooltip styling consistent cu design system\n- Legend styling",
    "cale_implementare": "/apps/web-admin/app/components/charts/chart-config.ts",
    "contextul_anterior": "Dashboard necesită grafice.",
    "validare_task": "Chart de test randează cu theme colors. Responsive funcționează.",
    "outcome_task": "Bază pentru toate componentele chart.",
    "restrictii_antihalucinatie": "NU folosim mai multe biblioteci de charts - doar Recharts.",
    "prioritate": "P1"
},
{
    "id_task": "FE2.2.2",
    "denumire_task": "LineChart Component (Metrics Over Time)",
    "descriere_task": "Line chart pentru metrici temporale:\n\n**Features:**\n- Multiple series support\n- Time axis formatting (hour, day, week)\n- Tooltip cu valori precise\n- Reference lines (thresholds)\n- Area fill optional\n- Zoom (brush selection)\n\n**Props:**\n```typescript\ninterface LineChartProps {\n  data: Array<{ date: Date; [key: string]: number }>;\n  series: Array<{ key: string; color: string; label: string }>;\n  xAxisKey?: string;\n  referenceLines?: Array<{ y: number; label: string; color: string }>;\n  height?: number;\n}\n```\n\n**Use Cases:**\n- Request latency over time\n- Queue throughput\n- Error rates",
    "cale_implementare": "/apps/web-admin/app/components/charts/line-chart.tsx",
    "contextul_anterior": "Charts library configurată.",
    "validare_task": "Chart afișează date mock corect. Hover arată tooltip. Reference line vizibilă.",
    "outcome_task": "Vizualizare metrici temporale.",
    "restrictii_antihalucinatie": "Formatează datele înainte de render - NU în componenta chart.",
    "prioritate": "P1"
},
{
    "id_task": "FE2.2.3",
    "denumire_task": "BarChart Component",
    "descriere_task": "Bar chart pentru comparații:\n\n**Variants:**\n- Vertical bars\n- Horizontal bars\n- Stacked bars\n- Grouped bars\n\n**Features:**\n- Labels pe bars\n- Color per category\n- Sorted display option\n- Click handler per bar\n\n**Use Cases:**\n- Jobs per queue\n- Products per category\n- Errors per type",
    "cale_implementare": "/apps/web-admin/app/components/charts/bar-chart.tsx",
    "contextul_anterior": "Charts library configurată.",
    "validare_task": "Bar chart cu date mock. Click pe bar funcționează. Labels vizibile.",
    "outcome_task": "Comparații vizuale clare.",
    "restrictii_antihalucinatie": "Max 20 bars pe chart - pentru mai multe, folosește horizontal cu scroll.",
    "prioritate": "P1"
},
{
    "id_task": "FE2.2.4",
    "denumire_task": "PieChart / DonutChart Component",
    "descriere_task": "Pie/Donut pentru distribuții:\n\n**Features:**\n- Donut variant cu center text\n- Legend external\n- Hover highlight segment\n- Click handler\n- % labels pe segments (optional)\n\n**Use Cases:**\n- Job status distribution\n- Product status breakdown\n- Error categorization",
    "cale_implementare": "/apps/web-admin/app/components/charts/pie-chart.tsx",
    "contextul_anterior": "Menționat în arhitectura frontend.",
    "validare_task": "Donut cu distribuție corectă. Hover highlight funcționează. Legend clickable.",
    "outcome_task": "Vizualizare proporții.",
    "restrictii_antihalucinatie": "Max 6-8 segments - restul grupate în 'Other'.",
    "prioritate": "P2"
},
{
    "id_task": "FE2.2.5",
    "denumire_task": "Sparkline Component (Inline Trends)",
    "descriere_task": "Mini grafic pentru trend inline:\n\n**Features:**\n- Lățime fixă (80-120px)\n- Înălțime mică (24-32px)\n- Color based on trend (green up, red down)\n- Tooltip simplu (value, date)\n- No axes - doar linia\n\n**Use Cases:**\n- Trend în KPI cards\n- Trend în table cells\n- Quick visual indicator",
    "cale_implementare": "/apps/web-admin/app/components/charts/sparkline.tsx",
    "contextul_anterior": "KPI cards pe dashboard.",
    "validare_task": "Sparkline în KPI card. Color corespunde trendului. Tooltip pe hover.",
    "outcome_task": "Trends la o privire în contexte inline.",
    "restrictii_antihalucinatie": "NU adăuga axes sau labels - păstrează minimal.",
    "prioritate": "P2"
},
{
    "id_task": "FE2.2.6",
    "denumire_task": "GaugeChart Component (Health Indicators)",
    "descriere_task": "Gauge pentru health/progress indicators:\n\n**Features:**\n- Semi-circle sau full circle variant\n- Color zones (green/yellow/red)\n- Animated needle\n- Center value display\n- Label\n\n**Use Cases:**\n- System health score\n- API rate limit usage\n- Queue capacity",
    "cale_implementare": "/apps/web-admin/app/components/charts/gauge-chart.tsx",
    "contextul_anterior": "Health dashboard menționat.",
    "validare_task": "Gauge afișează value corect. Color zones vizibile. Animation pe change.",
    "outcome_task": "Instant visual health status.",
    "restrictii_antihalucinatie": "NU folosim pentru valori exacte - gauge e pentru overview.",
    "prioritate": "P3"
}
]
```

### FE2.3: Input Components

```JSON
[
{
    "id_task": "FE2.3.1",
    "denumire_task": "SearchInput Component (Autocomplete)",
    "descriere_task": "Input de căutare cu autocomplete:\n\n**Features:**\n- Debounced input (300ms)\n- Dropdown cu sugestii\n- Recent searches (localStorage)\n- Keyboard navigation (arrows, enter, escape)\n- Clear button\n- Loading state\n- No results state\n\n**Props:**\n```typescript\ninterface SearchInputProps {\n  onSearch: (query: string) => void;\n  onSelect?: (item: SearchResult) => void;\n  suggestions?: SearchResult[];\n  loading?: boolean;\n  placeholder?: string;\n  recentSearches?: string[];\n}\n```",
    "cale_implementare": "/apps/web-admin/app/components/ui/search-input.tsx",
    "contextul_anterior": "AI search și product search necesită input avansat.",
    "validare_task": "Type → debounce → suggestions appear. Arrow keys navigare. Enter selectează.",
    "outcome_task": "Căutare rapidă și intuitivă.",
    "restrictii_antihalucinatie": "Debounce OBLIGATORIU pentru a evita spam la backend.",
    "prioritate": "P0"
},
{
    "id_task": "FE2.3.2",
    "denumire_task": "DateRangePicker Component",
    "descriere_task": "Selector interval de date:\n\n**Features:**\n- Calendar popup\n- Presets (Today, Last 7 days, Last 30 days, This month, Custom)\n- Start/End date inputs\n- Time selection (optional)\n- Timezone aware\n- Validation (end > start)\n\n**Props:**\n```typescript\ninterface DateRangePickerProps {\n  value: { from: Date; to: Date };\n  onChange: (range: { from: Date; to: Date }) => void;\n  presets?: DatePreset[];\n  showTime?: boolean;\n  timezone?: string;\n}\n```\n\n**Package:** date-fns + custom calendar sau react-day-picker",
    "cale_implementare": "/apps/web-admin/app/components/ui/date-range-picker.tsx",
    "contextul_anterior": "Metrici și logs necesită filtrare temporală.",
    "validare_task": "Selectare range funcționează. Presets funcționează. Validation end > start.",
    "outcome_task": "Filtrare temporală intuitivă.",
    "restrictii_antihalucinatie": "Folosește date-fns pentru manipulare date - NU moment.js.",
    "prioritate": "P0"
},
{
    "id_task": "FE2.3.3",
    "denumire_task": "MultiSelect Component (Tags)",
    "descriere_task": "Selector multiplu cu tags:\n\n**Features:**\n- Dropdown cu opțiuni\n- Selected items ca tags\n- Remove tag (X)\n- Search within options\n- Create new option (optional)\n- Max selections limit\n- Group options\n\n**Props:**\n```typescript\ninterface MultiSelectProps {\n  options: Option[];\n  value: string[];\n  onChange: (value: string[]) => void;\n  searchable?: boolean;\n  creatable?: boolean;\n  maxItems?: number;\n  grouped?: boolean;\n}\n```",
    "cale_implementare": "/apps/web-admin/app/components/ui/multi-select.tsx",
    "contextul_anterior": "Filtre pentru produse, queue topics.",
    "validare_task": "Select multiple funcționează. Tags afișate. Remove funcționează. Search funcționează.",
    "outcome_task": "Selecție multiplă intuitivă.",
    "restrictii_antihalucinatie": "Virtualizare pentru >100 opțiuni.",
    "prioritate": "P0"
},
{
    "id_task": "FE2.3.4",
    "denumire_task": "FileUpload Component (Drag & Drop)",
    "descriere_task": "Upload fișiere cu drag & drop:\n\n**Features:**\n- Drag & drop zone\n- Click to browse\n- Multiple files support\n- File type validation\n- Size validation\n- Progress indicator\n- Preview (images)\n- Remove file before upload\n\n**Props:**\n```typescript\ninterface FileUploadProps {\n  accept?: string; // '.json,.jsonl'\n  maxSize?: number; // bytes\n  multiple?: boolean;\n  onUpload: (files: File[]) => Promise<void>;\n  onRemove?: (file: File) => void;\n}\n```",
    "cale_implementare": "/apps/web-admin/app/components/ui/file-upload.tsx",
    "contextul_anterior": "Import date JSONL menționat.",
    "validare_task": "Drag file → drop zone highlight → upload → progress → complete.",
    "outcome_task": "Import fișiere intuitiv.",
    "restrictii_antihalucinatie": "Validează tip și size ÎNAINTE de upload.",
    "prioritate": "P1"
},
{
    "id_task": "FE2.3.5",
    "denumire_task": "CodeEditor Component (Monaco Lite)",
    "descriere_task": "Editor de cod pentru JSONL, GraphQL, configurări:\n\n**Features:**\n- Syntax highlighting (JSON, GraphQL, JavaScript)\n- Line numbers\n- Basic autocomplete\n- Error highlighting\n- Format button\n- Copy button\n- Read-only mode\n\n**Package:** @monaco-editor/react (lazy loaded)\n\n**Props:**\n```typescript\ninterface CodeEditorProps {\n  value: string;\n  onChange?: (value: string) => void;\n  language: 'json' | 'graphql' | 'javascript';\n  readOnly?: boolean;\n  height?: string;\n}\n```",
    "cale_implementare": "/apps/web-admin/app/components/ui/code-editor.tsx",
    "contextul_anterior": "JSONL viewing și GraphQL queries.",
    "validare_task": "Syntax highlighting vizibil. Format funcționează. Copy funcționează.",
    "outcome_task": "Editare cod confortabilă în browser.",
    "restrictii_antihalucinatie": "LAZY LOAD Monaco - bundle size mare. NU include în main bundle.",
    "prioritate": "P2"
},
{
    "id_task": "FE2.3.6",
    "denumire_task": "SliderInput Component",
    "descriere_task": "Slider pentru valori numerice cu range:\n\n**Features:**\n- Value label display\n- Min/max bounds\n- Step customizable\n- Marks/ticks optional\n- Dual handle for range selection\n- Disabled state\n\n**Use Cases:**\n- AI similarity threshold (0-1)\n- Concurrency settings (1-50)\n- Timeout values\n\n**Props:**\n```typescript\ninterface SliderProps {\n  value: number | [number, number];\n  onChange: (value: number | [number, number]) => void;\n  min: number;\n  max: number;\n  step?: number;\n  marks?: Array<{ value: number; label: string }>;\n}\n```",
    "cale_implementare": "/apps/web-admin/app/components/ui/slider.tsx",
    "contextul_anterior": "AI Search are similarity threshold slider.",
    "validare_task": "Drag slider → value updates. Marks afișate corect.",
    "outcome_task": "Input numeric vizual și intuitiv.",
    "restrictii_antihalucinatie": "Combinează cu input numeric pentru precizie.",
    "prioritate": "P2"
}
]
```

---

## FAZA FE3: All Pages Implementation

### FE3.1: Product Pages (Complete)

```JSON
[
{
    "id_task": "FE3.1.1",
    "denumire_task": "Product List Page - Complete Implementation",
    "descriere_task": "Pagină completă pentru lista de produse:\n\n**Layout:**\n- Header cu title, search, actions\n- Filters sidebar (collapsible)\n- Main content: DataTable\n- Pagination footer\n\n**Features:**\n- Search (title, SKU, vendor)\n- Filters: status, vendor, product_type, created_at range\n- Sort: title, created_at, updated_at, inventory\n- Bulk actions: export, sync, delete\n- Quick actions per row: view, edit, sync\n\n**Data:**\n- Loader cu paginare server-side\n- Optimistic updates pentru actions\n- Cache cu revalidation",
    "cale_implementare": "/apps/web-admin/app/routes/products._index.tsx",
    "contextul_anterior": "app.products.tsx menționat ca parțial.",
    "validare_task": "Search funcționează. Filters funcționează. Pagination funcționează. Bulk select funcționează.",
    "outcome_task": "Gestiune completă produse din UI.",
    "restrictii_antihalucinatie": "Paginare SERVER-SIDE - nu încărcăm 1M produse în browser.",
    "prioritate": "P0"
},
{
    "id_task": "FE3.1.2",
    "denumire_task": "Product Detail Page",
    "descriere_task": "Pagină detalii produs (read-only):\n\n**Layout:**\n- Breadcrumb: Products > {product.title}\n- Header: image, title, status badge, actions\n- Tabs: Overview, Variants, Metafields, History\n\n**Overview Tab:**\n- Description (HTML rendered)\n- Vendor, Type, Tags\n- Created/Updated dates\n- Shopify admin link\n\n**Variants Tab:**\n- Variants table cu SKU, price, inventory\n- Click → variant detail modal\n\n**Metafields Tab:**\n- JsonViewer pentru metafields\n- Grouped by namespace\n\n**History Tab:**\n- Timeline cu sync history, changes\n\n**Route:** /products/:id",
    "cale_implementare": "/apps/web-admin/app/routes/products.$id.tsx",
    "contextul_anterior": "Lista produse există.",
    "validare_task": "Navigate din listă → detail page. Tabs funcționează. Toate datele afișate.",
    "outcome_task": "View complet produs.",
    "restrictii_antihalucinatie": "Read-only în V1. Edit în task separat.",
    "prioritate": "P0"
},
{
    "id_task": "FE3.1.3",
    "denumire_task": "Product Editor Page",
    "descriere_task": "Pagină editare produs:\n\n**Form Sections:**\n1. Basic Info: title, description (rich text), vendor, type\n2. Media: image gallery cu reorder\n3. Pricing: price, compare_at_price, cost\n4. Inventory: SKU, barcode, track quantity\n5. Variants: variant matrix (options × combinations)\n6. SEO: meta title, meta description, URL handle\n7. Metafields: custom fields\n\n**Features:**\n- Autosave draft (localStorage)\n- Validation cu Zod\n- Preview changes\n- Discard changes confirmation\n- Save → push to Shopify\n\n**Route:** /products/:id/edit",
    "cale_implementare": "/apps/web-admin/app/routes/products.$id.edit.tsx",
    "contextul_anterior": "Product detail page există.",
    "validare_task": "Edit field → autosave indicator. Save → Shopify update. Validation errors afișate.",
    "outcome_task": "Editare produse fără a părăsi aplicația.",
    "restrictii_antihalucinatie": "Autosave în localStorage, NU la server la fiecare keystroke.",
    "prioritate": "P1"
},
{
    "id_task": "FE3.1.4",
    "denumire_task": "Product Import/Export Page",
    "descriere_task": "Pagină pentru import/export bulk produse:\n\n**Export:**\n- Format selector: CSV, JSON, JSONL\n- Field selector (checkbox list)\n- Filter: all, selection, filtered\n- Progress indicator\n- Download când gata\n\n**Import:**\n- File upload (CSV, JSON, JSONL)\n- Column mapping UI\n- Validation preview\n- Conflict resolution options\n- Progress indicator\n- Results summary\n\n**Route:** /products/import-export",
    "cale_implementare": "/apps/web-admin/app/routes/products.import-export.tsx",
    "contextul_anterior": "Bulk operations sunt core pentru 1M+ SKU.",
    "validare_task": "Export selectat funcționează. Import cu mapping funcționează. Errors afișate.",
    "outcome_task": "Bulk operations pentru produse.",
    "restrictii_antihalucinatie": "Server-side processing - UI doar pentru status și config.",
    "prioritate": "P1"
}
]
```

### FE3.2: Queue & Jobs Pages

```JSON
[
{
    "id_task": "FE3.2.1",
    "denumire_task": "Queue Monitor Page - Enhanced",
    "descriere_task": "Dashboard complet pentru monitorizare cozi:\n\n**Layout:**\n- Queue selector tabs (webhooks, bulk, sync, ai)\n- Metrics cards: active, waiting, completed, failed\n- Jobs table cu real-time updates\n- Workers status sidebar\n\n**Features:**\n- Real-time refresh (WebSocket sau polling)\n- Filter by status\n- Search by job ID\n- Bulk retry failed\n- Pause/Resume queue\n- Clear completed\n\n**Charts:**\n- Throughput over time (line)\n- Status distribution (donut)\n- Wait time histogram\n\n**Route:** /queues",
    "cale_implementare": "/apps/web-admin/app/routes/queues._index.tsx",
    "contextul_anterior": "app.queues.tsx există partial.",
    "validare_task": "Real-time updates vizibile. Retry funcționează. Charts afișează date.",
    "outcome_task": "Monitorizare completă cozi BullMQ.",
    "restrictii_antihalucinatie": "Polling interval configurabil. NU WebSocket pentru MVP.",
    "prioritate": "P0"
},
{
    "id_task": "FE3.2.2",
    "denumire_task": "Job Detail Modal",
    "descriere_task": "Modal cu detalii complete job:\n\n**Content:**\n- Job ID (copy button)\n- Status badge\n- Queue name\n- Attempt counter\n- Created, Started, Completed timestamps\n- Duration\n- Data payload (JsonViewer)\n- Stack trace (if failed)\n- Logs (from job)\n\n**Actions:**\n- Retry\n- Promote (if delayed)\n- Remove\n- View in Jaeger (trace link)\n\n**Trigger:** Click pe row în jobs table",
    "cale_implementare": "/apps/web-admin/app/components/domain/JobDetailModal.tsx",
    "contextul_anterior": "Queue monitor există.",
    "validare_task": "Click job → modal opens. Toate detaliile afișate. Actions funcționează.",
    "outcome_task": "Debugging jobs fără console access.",
    "restrictii_antihalucinatie": "NU expuneți secrets din payload - redactare obligatorie.",
    "prioritate": "P1"
},
{
    "id_task": "FE3.2.3",
    "denumire_task": "Workers Status Page",
    "descriere_task": "Pagină dedicată pentru status workeri:\n\n**Layout:**\n- Grid de worker cards\n- Summary bar: total, online, busy, idle\n\n**Worker Card:**\n- Worker ID\n- Status indicator (green/yellow/gray)\n- Current job (if any)\n- Jobs processed count\n- CPU/Memory usage (if available)\n- Uptime\n\n**Actions:**\n- Graceful shutdown\n- Drain (finish current, no new)\n\n**Route:** /queues/workers",
    "cale_implementare": "/apps/web-admin/app/routes/queues.workers.tsx",
    "contextul_anterior": "Tab 'Workeri' menționat în arhitectura frontend.",
    "validare_task": "Workers afișați corect. Status real-time. Actions funcționează.",
    "outcome_task": "Vizibilitate în procesare distribuită.",
    "restrictii_antihalucinatie": "Graceful actions - NU kill brutal.",
    "prioritate": "P2"
}
]
```

### FE3.3: Ingestion & Bulk Operations Pages

```JSON
[
{
    "id_task": "FE3.3.1",
    "denumire_task": "Ingestion Control Page - Enhanced",
    "descriere_task": "Pagină completă pentru control ingestie:\n\n**States:**\n1. **Idle:** Start button, last sync info, dropzone pentru test\n2. **Running:** Progress bar cu %, stepper pentru stages, live metrics, abort button\n3. **Completed:** Summary stats, errors list, duration, download report\n4. **Failed:** Error details, stack trace, retry options\n\n**Stages Stepper:**\n1. Initialize → 2. Download JSONL → 3. Parse → 4. Transform → 5. Insert DB\n\n**Live Metrics:**\n- Records/sec\n- Total processed\n- Estimated time remaining\n- Memory usage\n\n**Log Console:** (collapsible)\n- Scrollable log output\n- Toggle: All / Errors only\n- Download logs button\n\n**Route:** /ingestion",
    "cale_implementare": "/apps/web-admin/app/routes/ingestion._index.tsx",
    "contextul_anterior": "app.ingestion.tsx există partial.",
    "validare_task": "Start sync → progress vizibil → complete cu stats. Abort funcționează. Logs afișate.",
    "outcome_task": "Control complet asupra pipeline-ului de ingestie.",
    "restrictii_antihalucinatie": "Confirmarea pentru Abort - operație costisitoare.",
    "prioritate": "P0"
},
{
    "id_task": "FE3.3.2",
    "denumire_task": "Bulk Operations History Page",
    "descriere_task": "Pagină cu istoricul operațiilor bulk:\n\n**Table Columns:**\n- Operation ID\n- Type (full_sync, incremental, webhook_batch)\n- Status (badge)\n- Started / Completed\n- Duration\n- Records processed\n- Errors count\n- Actions (view details, retry, download)\n\n**Filters:**\n- Status filter\n- Type filter\n- Date range\n\n**Route:** /ingestion/history",
    "cale_implementare": "/apps/web-admin/app/routes/ingestion.history.tsx",
    "contextul_anterior": "Ingestion page principală există.",
    "validare_task": "Istoric afișat corect. Filters funcționează. Click → detail modal.",
    "outcome_task": "Audit trail pentru operații bulk.",
    "restrictii_antihalucinatie": "Paginare server-side pentru istoric mare.",
    "prioritate": "P1"
},
{
    "id_task": "FE3.3.3",
    "denumire_task": "Schedule Sync Page",
    "descriere_task": "Pagină pentru programare sync-uri automate:\n\n**Features:**\n- Enable/Disable scheduled sync\n- Cron expression builder (visual)\n- Next 5 scheduled runs preview\n- History of scheduled runs\n- Email notification on complete/fail\n\n**Cron Builder:**\n- Presets: Daily at X, Weekly on Y, Monthly on Z\n- Custom: minute, hour, day, month, weekday selectors\n- Preview text: 'Every day at 3:00 AM'\n\n**Route:** /ingestion/schedule",
    "cale_implementare": "/apps/web-admin/app/routes/ingestion.schedule.tsx",
    "contextul_anterior": "Bulk operations există.",
    "validare_task": "Enable schedule → next runs shown. Cron builder funcționează. Toggle enable/disable.",
    "outcome_task": "Automatizare sync fără intervenție manuală.",
    "restrictii_antihalucinatie": "Cron expression TREBUIE validat. Afișează next runs pentru confirmare.",
    "prioritate": "P2"
}
]
```

### FE3.4: AI & Search Pages

```JSON
[
{
    "id_task": "FE3.4.1",
    "denumire_task": "AI Search Playground Page - Complete",
    "descriere_task": "Pagină completă pentru căutare AI semantică:\n\n**Layout:**\n- Left sidebar (300px): Query input, parameters\n- Right main: Results grid\n\n**Query Panel:**\n- Textarea pentru query natural language\n- Slider: Similarity threshold (0.5-1.0)\n- Number input: Max results (1-100)\n- Switch: Include metadata\n- Button: Execute Search\n\n**Results Grid:**\n- Product cards cu thumbnail, title, price\n- Similarity score badge (color coded)\n- Click → Product detail modal\n- Compare selected products\n\n**Empty State:** Ilustrație + instrucțiuni\n**No Results:** Sugestii pentru query diferit\n\n**Route:** /search",
    "cale_implementare": "/apps/web-admin/app/routes/search._index.tsx",
    "contextul_anterior": "app.search.tsx menționat.",
    "validare_task": "Query text → results cu scores. Threshold afectează rezultatele. Click → detail.",
    "outcome_task": "Testare și demonstrare AI search.",
    "restrictii_antihalucinatie": "Loading state clar - search poate dura.",
    "prioritate": "P1"
},
{
    "id_task": "FE3.4.2",
    "denumire_task": "Deduplication UI Page",
    "descriere_task": "Pagină pentru detectare și gestionare duplicate:\n\n**Workflow:**\n1. Scan for duplicates (trigger button)\n2. Review duplicate groups\n3. Select master record per group\n4. Merge / Keep both / Ignore\n\n**Duplicate Group Card:**\n- Side by side comparison\n- Similarity score\n- Highlight differences\n- Merge controls\n\n**Table View:**\n- Groups list cu count\n- Expand → see products în grup\n\n**Route:** /search/deduplication",
    "cale_implementare": "/apps/web-admin/app/routes/search.deduplication.tsx",
    "contextul_anterior": "F5.2.9 menționează deduplicare la ingestie.",
    "validare_task": "Scan returnează grupuri. Comparison vizibil. Merge funcționează.",
    "outcome_task": "Curățare duplicate din UI.",
    "restrictii_antihalucinatie": "Confirmarea pentru merge - acțiune ireversibilă.",
    "prioritate": "P2"
},
{
    "id_task": "FE3.4.3",
    "denumire_task": "AI Embeddings Status Page",
    "descriere_task": "Pagină pentru status generare embeddings:\n\n**Content:**\n- Progress overall: X / Y products embedded\n- Progress bar\n- Batch status (processing, completed, failed)\n- OpenAI API usage stats\n- Cost estimation\n- Retry failed button\n\n**Table:**\n- Recent batches cu status\n- Click → batch details\n\n**Route:** /search/embeddings",
    "cale_implementare": "/apps/web-admin/app/routes/search.embeddings.tsx",
    "contextul_anterior": "F6 AI batch processing.",
    "validare_task": "Status embeddings vizibil. Progress corect. Retry funcționează.",
    "outcome_task": "Vizibilitate în procesare AI.",
    "restrictii_antihalucinatie": "Afișează cost ESTIMATION - nu actual charges.",
    "prioritate": "P2"
}
]
```

### FE3.5: Webhook & Integration Pages

```JSON
[
{
    "id_task": "FE3.5.1",
    "denumire_task": "Webhook Monitor Page",
    "descriere_task": "Pagină pentru monitorizare webhooks:\n\n**Metrics Cards:**\n- Total received (24h)\n- Success rate (%)\n- Average processing time\n- Failed count (red badge)\n\n**Table:**\n- Topic (products/update, orders/create, etc.)\n- Shop\n- Status (success/failed/processing)\n- Received at\n- Processing time\n- Actions (view, replay)\n\n**Filters:**\n- Topic dropdown\n- Status filter\n- Shop filter\n- Date range\n\n**Route:** /webhooks",
    "cale_implementare": "/apps/web-admin/app/routes/webhooks._index.tsx",
    "contextul_anterior": "F3.3 definește webhook endpoints.",
    "validare_task": "Webhooks afișate. Filters funcționează. Click → detail modal.",
    "outcome_task": "Monitorizare completă webhooks.",
    "restrictii_antihalucinatie": "Paginare - volume mari de webhooks.",
    "prioritate": "P1"
},
{
    "id_task": "FE3.5.2",
    "denumire_task": "Webhook Detail & Replay Modal",
    "descriere_task": "Modal pentru detalii și replay webhook:\n\n**Content:**\n- Webhook ID\n- Topic\n- Shop\n- Received timestamp\n- Processing duration\n- Status cu error (if failed)\n- Payload (JsonViewer)\n- Headers (filtered - no secrets)\n\n**Actions:**\n- Replay (reprocess)\n- Mark as ignored\n- View related product/order\n\n**Replay Options:**\n- Edit payload before replay (optional)\n- Add to queue immediately / schedule",
    "cale_implementare": "/apps/web-admin/app/components/domain/WebhookDetailModal.tsx",
    "contextul_anterior": "Webhook monitor există.",
    "validare_task": "Click webhook → modal. Payload afișat. Replay funcționează.",
    "outcome_task": "Debugging și recovery pentru webhooks failed.",
    "restrictii_antihalucinatie": "Replay → confirmation dialog. NU replay automat în loop.",
    "prioritate": "P1"
},
{
    "id_task": "FE3.5.3",
    "denumire_task": "Shopify Connection Status Page",
    "descriere_task": "Pagină pentru status conexiune Shopify:\n\n**Content:**\n- Connection status indicator (connected/disconnected/degraded)\n- Shop details (name, URL, plan)\n- Scopes granted\n- Token status (valid/expired)\n- Rate limit usage (graph)\n- Last API call timestamp\n\n**Actions:**\n- Reconnect / Refresh token\n- Update scopes\n- Test connection\n\n**API Health:**\n- Response time trend\n- Error rate\n- 429 (rate limited) count\n\n**Route:** /integrations/shopify",
    "cale_implementare": "/apps/web-admin/app/routes/integrations.shopify.tsx",
    "contextul_anterior": "F3.2 OAuth implementation.",
    "validare_task": "Status afișat corect. Test connection funcționează. Rate limit vizibil.",
    "outcome_task": "Vizibilitate în health integrare Shopify.",
    "restrictii_antihalucinatie": "NU expuneți token complet - doar status și last chars.",
    "prioritate": "P1"
}
]
```

### FE3.6: Settings Pages (Complete)

```JSON
[
{
    "id_task": "FE3.6.1",
    "denumire_task": "Settings Layout & Navigation",
    "descriere_task": "Layout master pentru pagini settings:\n\n**Layout:**\n- Left sidebar: settings categories\n- Right: settings content\n\n**Categories:**\n1. General (app name, timezone, language)\n2. Shopify Connection\n3. Queue Settings\n4. AI Configuration\n5. Notifications\n6. Security\n7. About\n\n**Route:** /settings",
    "cale_implementare": "/apps/web-admin/app/routes/settings.tsx (layout)",
    "contextul_anterior": "app.settings.tsx există ca placeholder.",
    "validare_task": "Navigation între settings categories funcționează. Layout responsive.",
    "outcome_task": "Structură pentru toate setările.",
    "restrictii_antihalucinatie": "Fiecare category = route separată pentru code splitting.",
    "prioritate": "P1"
},
{
    "id_task": "FE3.6.2",
    "denumire_task": "General Settings Page",
    "descriere_task": "Setări generale aplicație:\n\n**Fields:**\n- App display name\n- Default timezone (select)\n- Language (EN/RO)\n- Date format preference\n- Number format (1,000.00 vs 1.000,00)\n- Dark mode toggle\n\n**Route:** /settings/general",
    "cale_implementare": "/apps/web-admin/app/routes/settings.general.tsx",
    "contextul_anterior": "Settings layout există.",
    "validare_task": "Change setting → save → persists. Language change → UI updates.",
    "outcome_task": "Personalizare experiență.",
    "restrictii_antihalucinatie": "Persist în localStorage + sync cu backend pentru persistence.",
    "prioritate": "P1"
},
{
    "id_task": "FE3.6.3",
    "denumire_task": "Queue Settings Page",
    "descriere_task": "Configurare cozi și procesare:\n\n**Fields:**\n- Default worker concurrency (1-50)\n- Max retry attempts (1-10)\n- Retry delay (seconds)\n- Job timeout (seconds)\n- Priority queue enabled\n- Rate limiting settings\n\n**Validation:**\n- Numeric ranges\n- Warnings pentru valori extreme\n\n**Route:** /settings/queues",
    "cale_implementare": "/apps/web-admin/app/routes/settings.queues.tsx",
    "contextul_anterior": "Settings layout există.",
    "validare_task": "Save settings → workers use new values. Validation afișată.",
    "outcome_task": "Tuning procesare fără cod.",
    "restrictii_antihalucinatie": "Confirmation pentru changes cu impact mare (ex: concurrency).",
    "prioritate": "P2"
},
{
    "id_task": "FE3.6.4",
    "denumire_task": "AI Configuration Page",
    "descriere_task": "Configurare AI și embeddings:\n\n**Fields:**\n- OpenAI Model (dropdown: gpt-4, gpt-3.5-turbo, text-embedding-3-small)\n- Temperature (0-2 slider)\n- Max tokens (100-4000)\n- Embedding batch size\n- Auto-embed new products (toggle)\n- Similarity threshold default\n\n**Status:**\n- API key status (valid/invalid)\n- Usage this month (API calls, cost estimate)\n\n**Route:** /settings/ai",
    "cale_implementare": "/apps/web-admin/app/routes/settings.ai.tsx",
    "contextul_anterior": "Settings layout există.",
    "validare_task": "Model change persists. API key validation funcționează.",
    "outcome_task": "Configurare AI din UI.",
    "restrictii_antihalucinatie": "API key masked - doar view/change, nu display full.",
    "prioritate": "P2"
},
{
    "id_task": "FE3.6.5",
    "denumire_task": "Notification Settings Page",
    "descriere_task": "Configurare notificări și alerte:\n\n**Channels:**\n- Email (address, toggle per event type)\n- Slack (webhook URL, channel, toggle per event)\n- In-app (browser notifications toggle)\n\n**Events:**\n- Sync completed\n- Sync failed\n- High error rate\n- Rate limit warning\n- Worker down\n\n**Test buttons:** Send test notification per channel\n\n**Route:** /settings/notifications",
    "cale_implementare": "/apps/web-admin/app/routes/settings.notifications.tsx",
    "contextul_anterior": "Settings layout există.",
    "validare_task": "Toggle events → persist. Test notification → received.",
    "outcome_task": "Control complet asupra alertelor.",
    "restrictii_antihalucinatie": "Validate Slack URL format. Email validation.",
    "prioritate": "P2"
},
{
    "id_task": "FE3.6.6",
    "denumire_task": "Security Settings Page",
    "descriere_task": "Setări de securitate:\n\n**Content:**\n- Active sessions list (device, IP, last active)\n- Logout other sessions button\n- Change password form\n- Two-factor authentication (setup/disable)\n- API keys management (list, create, revoke)\n- Audit log link\n\n**Route:** /settings/security",
    "cale_implementare": "/apps/web-admin/app/routes/settings.security.tsx",
    "contextul_anterior": "Settings layout există.",
    "validare_task": "Sessions listed. Logout others funcționează. API key create/revoke.",
    "outcome_task": "Control securitate din UI.",
    "restrictii_antihalucinatie": "Password change = re-authentication required.",
    "prioritate": "P2"
}
]
```

---

## FAZA FE4: Dialoguri & Modale Complete

```JSON
[
{
    "id_task": "FE4.1.1",
    "denumire_task": "Confirmation Dialog System",
    "descriere_task": "Sistem centralizat pentru dialoguri de confirmare:\n\n**Hook:**\n```typescript\nconst { confirm, ConfirmDialog } = useConfirmation();\n\n// Usage\nconst handleDelete = async () => {\n  const confirmed = await confirm({\n    title: 'Delete Product?',\n    description: 'This action cannot be undone.',\n    confirmText: 'Delete',\n    variant: 'destructive'\n  });\n  if (confirmed) {\n    // perform delete\n  }\n};\n```\n\n**Variants:**\n- default (blue confirm)\n- destructive (red confirm)\n- warning (yellow confirm)\n\n**Components:**\n- DeleteConfirmation\n- BulkDeleteConfirmation\n- AbortOperationConfirmation\n- UnsavedChangesConfirmation\n- LogoutConfirmation",
    "cale_implementare": "/apps/web-admin/app/hooks/use-confirmation.tsx, /apps/web-admin/app/components/ui/confirm-dialog.tsx",
    "contextul_anterior": "AlertDialog din Polaris există.",
    "validare_task": "confirm() returns Promise. Dialog afișat. Confirm/Cancel funcționează.",
    "outcome_task": "Confirmări consistente în toată aplicația.",
    "restrictii_antihalucinatie": "TOATE acțiunile destructive folosesc confirm().",
    "prioritate": "P0"
},
{
    "id_task": "FE4.1.2",
    "denumire_task": "Start Sync Modal",
    "descriere_task": "Modal pentru configurare și pornire sync:\n\n**Content:**\n- Sync type: Full / Incremental / Specific products\n- Date range (for incremental)\n- Product selection (for specific)\n- Options: include variants, include metafields, include inventory\n- Estimated duration\n- Warning pentru full sync la volume mare\n\n**Actions:**\n- Cancel\n- Start Sync\n\n**Trigger:** Start Sync button pe Dashboard/Ingestion page",
    "cale_implementare": "/apps/web-admin/app/components/domain/StartSyncModal.tsx",
    "contextul_anterior": "Ingestion page există.",
    "validare_task": "Open modal → configure → start → redirect to ingestion page cu progress.",
    "outcome_task": "Control granular asupra sync.",
    "restrictii_antihalucinatie": "Confirmation pentru full sync pe volume > 10K produse.",
    "prioritate": "P1"
},
{
    "id_task": "FE4.1.3",
    "denumire_task": "Export Data Modal",
    "descriere_task": "Modal pentru configurare export:\n\n**Content:**\n- Export type: Products / Orders / Inventory / Webhooks / Audit logs\n- Format: CSV, JSON, JSONL, Excel\n- Fields selector (checkbox list cu select all)\n- Filters: status, date range, custom\n- Filename\n\n**Actions:**\n- Cancel\n- Export (download sau email when ready)\n\n**Progress:** Pentru export-uri mari, arată progress și notifică când gata",
    "cale_implementare": "/apps/web-admin/app/components/domain/ExportDataModal.tsx",
    "contextul_anterior": "Import/Export page există.",
    "validare_task": "Configure → Export → Download file corect.",
    "outcome_task": "Export flexibil din UI.",
    "restrictii_antihalucinatie": "Export-uri mari = async cu notificare, NU blocking UI.",
    "prioritate": "P1"
},
{
    "id_task": "FE4.1.4",
    "denumire_task": "Import Data Modal",
    "descriere_task": "Modal pentru import date:\n\n**Steps:**\n1. **Upload:** File upload component (CSV, JSON, JSONL)\n2. **Preview:** First 5 rows preview\n3. **Mapping:** Column mapping (source → target field)\n4. **Options:** On conflict (update/skip/error), dry run toggle\n5. **Confirm:** Summary și start import\n\n**Validation:**\n- Required fields check\n- Data type validation preview\n- Error count estimate",
    "cale_implementare": "/apps/web-admin/app/components/domain/ImportDataModal.tsx",
    "contextul_anterior": "Import/Export page există.",
    "validare_task": "Upload → Preview → Map → Import. Errors afișate înainte de import.",
    "outcome_task": "Import flexibil cu validare.",
    "restrictii_antihalucinatie": "DRY RUN recomandat pentru prima încercare.",
    "prioritate": "P1"
},
{
    "id_task": "FE4.1.5",
    "denumire_task": "Keyboard Shortcuts Help Modal",
    "descriere_task": "Modal cu toate keyboard shortcuts:\n\n**Content:**\n- Grouped by category (Navigation, Actions, Global)\n- Key combination + description\n- Search within shortcuts\n\n**Shortcuts:**\n- Ctrl+K: Open command palette/search\n- Ctrl+/: Open this help\n- G then D: Go to Dashboard\n- G then P: Go to Products\n- G then Q: Go to Queues\n- G then S: Go to Settings\n- ?: Open help\n\n**Trigger:** Ctrl+/ sau ? key",
    "cale_implementare": "/apps/web-admin/app/components/domain/KeyboardShortcutsModal.tsx",
    "contextul_anterior": "F7.6.6 menționează shortcuts.",
    "validare_task": "Press ? → modal opens. All shortcuts listed. Press shortcut → action.",
    "outcome_task": "Power user efficiency.",
    "restrictii_antihalucinatie": "NU override browser shortcuts (Ctrl+T, Ctrl+W).",
    "prioritate": "P2"
},
{
    "id_task": "FE4.1.6",
    "denumire_task": "Whats New Modal (Release Notes)",
    "descriere_task": "Modal pentru afișare release notes:\n\n**Content:**\n- Version number\n- Date\n- New features (icons + descriptions)\n- Bug fixes\n- Breaking changes (warning style)\n- Link to full changelog\n\n**Behavior:**\n- Auto-show după update (once per version)\n- Dismissible, persistent dismiss\n- Accessible din Help menu\n\n**Storage:** lastSeenVersion în localStorage",
    "cale_implementare": "/apps/web-admin/app/components/domain/WhatsNewModal.tsx",
    "contextul_anterior": "Help system.",
    "validare_task": "New version → modal auto-shows. Dismiss persists. Manual open din menu.",
    "outcome_task": "Utilizatori informați despre updates.",
    "restrictii_antihalucinatie": "NU force modal - easily dismissible.",
    "prioritate": "P3"
}
]
```

---

## FAZA FE5: Hooks & Utilities Complete

```JSON
[
{
    "id_task": "FE5.1.1",
    "denumire_task": "Data Fetching Hooks",
    "descriere_task": "Hooks pentru data fetching cu caching:\n\n**Hooks:**\n```typescript\nuseProducts(filters) → { products, loading, error, refetch, hasMore }\nuseProduct(id) → { product, loading, error, mutate }\nuseJobs(queue, filters) → { jobs, loading, error, refetch }\nuseQueues() → { queues, loading, error }\nuseShopHealth() → { health, loading, error }\nuseAuditLogs(filters) → { logs, loading, error, hasMore }\n```\n\n**Implementation:**\n- Use React Router loaders where possible\n- SWR/TanStack Query pentru client-side refetching\n- Automatic retry pe network errors\n- Stale-while-revalidate caching",
    "cale_implementare": "/apps/web-admin/app/hooks/use-data/",
    "contextul_anterior": "Data fetching needed pentru toate paginile.",
    "validare_task": "Hook returnează date. Loading state funcționează. Error handling funcționează. Refetch funcționează.",
    "outcome_task": "Data fetching consistent și efficient.",
    "restrictii_antihalucinatie": "Prefer React Router loaders pentru initial data. Hooks pentru mutations și refetching.",
    "prioritate": "P0"
},
{
    "id_task": "FE5.1.2",
    "denumire_task": "Real-time Hooks",
    "descriere_task": "Hooks pentru real-time updates:\n\n**Hooks:**\n```typescript\nuseLiveQueue(queueName) → { jobs, counts, isConnected }\nuseLiveMetrics(interval) → { metrics, lastUpdate }\nuseJobProgress(jobId) → { progress, status, isComplete }\nuseSystemHealth(interval) → { status, services }\n```\n\n**Implementation:**\n- Polling with configurable interval\n- Auto-pause when tab not visible\n- Reconnection logic\n- Optimistic updates",
    "cale_implementare": "/apps/web-admin/app/hooks/use-realtime/",
    "contextul_anterior": "Queue monitor necesită real-time.",
    "validare_task": "Data updates periodic. Pause când tab hidden. Resume când visible.",
    "outcome_task": "Real-time experience fără WebSocket complexity.",
    "restrictii_antihalucinatie": "Polling, NU WebSocket în MVP. Interval min 2s.",
    "prioritate": "P1"
},
{
    "id_task": "FE5.1.3",
    "denumire_task": "UI State Hooks",
    "descriere_task": "Hooks pentru UI state management:\n\n**Hooks:**\n```typescript\nuseTableState(key) → { sort, filters, page, pageSize, setters }\nuseBulkSelection<T>(items) → { selected, toggle, selectAll, clear, isSelected }\nuseDisclosure() → { isOpen, onOpen, onClose, onToggle }\nusePagination(total, perPage) → { page, pages, next, prev, goTo, canNext, canPrev }\nuseDebounce<T>(value, delay) → debouncedValue\nuseThrottle<T>(value, delay) → throttledValue\n```",
    "cale_implementare": "/apps/web-admin/app/hooks/use-ui/",
    "contextul_anterior": "Tables și selections în multe pagini.",
    "validare_task": "useTableState persist sort/filters. useBulkSelection toggle funcționează.",
    "outcome_task": "UI state management reusable.",
    "restrictii_antihalucinatie": "Persist relevant state în URL params pentru shareability.",
    "prioritate": "P0"
},
{
    "id_task": "FE5.1.4",
    "denumire_task": "Utility Hooks",
    "descriere_task": "Hooks utilitare generale:\n\n**Hooks:**\n```typescript\nuseCopyToClipboard() → { copy: (text) => Promise<boolean>, copied: boolean }\nuseLocalStorage<T>(key, initial) → [value, setValue]\nuseSessionStorage<T>(key, initial) → [value, setValue]\nuseDarkMode() → { isDark, setDark, toggleDark, systemPreference }\nuseMediaQuery(query) → boolean\nuseOnClickOutside(ref, handler)\nuseKeyPress(key) → boolean\nuseEventListener(eventName, handler, element)\n```",
    "cale_implementare": "/apps/web-admin/app/hooks/use-utils/",
    "contextul_anterior": "Utilități comune în multe componente.",
    "validare_task": "Copy to clipboard funcționează. localStorage persist. Media query responsive.",
    "outcome_task": "DRY pentru patterns comune.",
    "restrictii_antihalucinatie": "NU duplica aceste utilities - folosește hook-urile.",
    "prioritate": "P1"
},
{
    "id_task": "FE5.1.5",
    "denumire_task": "useKeyboardShortcuts Hook",
    "descriere_task": "Hook pentru keyboard shortcuts globale:\n\n**Implementation:**\n```typescript\nuseKeyboardShortcuts({\n  'ctrl+k': () => openCommandPalette(),\n  'ctrl+/': () => openHelp(),\n  'g d': () => navigate('/'),\n  'g p': () => navigate('/products'),\n  'g q': () => navigate('/queues'),\n  '?': () => openShortcutsHelp(),\n});\n```\n\n**Features:**\n- Chord support (g then p)\n- Modifier keys (ctrl, shift, alt, meta)\n- Disable when in input/textarea\n- Priority levels for conflicts",
    "cale_implementare": "/apps/web-admin/app/hooks/use-keyboard-shortcuts.ts",
    "contextul_anterior": "F7.6.6 menționează shortcuts.",
    "validare_task": "Press shortcut → action executed. În input → disabled.",
    "outcome_task": "Power user navigation.",
    "restrictii_antihalucinatie": "DISABLE în inputs. Check pentru conflict cu browser.",
    "prioritate": "P2"
}
]
```

---

## Rezumat Total Taskuri Frontend

| Fază | Taskuri | Efort Estimat |
|------|---------|---------------|
| FE1: Design System | 7 | 20h |
| FE2: Core Components | 17 | 60h |
| FE3: All Pages | 22 | 100h |
| FE4: Dialoguri & Modale | 6 | 25h |
| FE5: Hooks & Utilities | 5 | 20h |
| **TOTAL** | **57 taskuri noi** | **225h** |

**Combinat cu taskurile existente din Plan_de_implementare.md:**
- F3.5: ~15 taskuri existente
- F7.6: 9 taskuri existente
- F7.7: 4 taskuri existente
- F8.3: 4 taskuri existente

**TOTAL FRONTEND COMPLET: ~89 taskuri**

---

**Document generat ca parte a auditului comprehensiv din 26 Decembrie 2025.**

