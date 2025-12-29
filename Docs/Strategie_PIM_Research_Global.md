# Neanelu Global PIM & Data Factory Strategy

## 1. Viziune: De la "Depozit" la "Uzină de Date"

Obiectivul este de a construi un sistem cu **Autonomie Ridicată** care transformă date brute din web în înregistrări perfecte de produs (Golden Records).
Filozofia: **"Trust but Verify"**.

---

## 2. Arhitectura Datelor (4 Layers)

Datele curg unidirecțional, de la haos la ordine.

### **Layer 1: Governance (Taxonomie & Reguli)**

*Acesta este "Creierul". Nu stochează produse, ci regulile despre cum ar trebui să arate produsele.*

* **`prod_taxonomy`**:
  * **Sursa:** Import automat din **Shopify Standard Taxonomy** (GitHub JSON).
  * **Rol:** Definește categoriile și atributele lor obligatorii (`attribute_schema`).
* **`prod_attr_definitions`**:
  * Registrul atributelor canonice (`display_size`, `weight_kg`).
* **`prod_attr_synonyms`**:
  * Motorul de traducere (`screen res` -> `display_resolution`) bazat pe Vector Search.

### **Layer 2: Ingestion (Data Lake)**

*Aici stocăm materia primă. Append-Only.*

* **`prod_raw_harvest`**:
  * Payload complet (HTML/JSON) de la crawlere.
  * Retenție: 90 zile pentru audit, apoi ștergere sau arhivare.

### **Layer 3: Metadata & Processing (Consensus)**

*Zona de lucru. Aici se întâmplă magia AI.*

* **`prod_extraction_sessions`**:
  * Rezultatele brute ale fiecărui agent AI.
  * Ex: `Agent_A_Session_01` a extras `{color: red}`.
* **`prod_proposals`**:
  * Date consolidate care așteaptă votul final (Consens) sau aprobarea umană.

### **Layer 4: Golden Record (Output)**

*Adevărul livrat către Shopify/Google.*

* **`prod_core`**: Identitate (UUIDv7, SKU).
* **`prod_specs`**: Atribute tehnice normalizate (JSONB validat de Taxonomie).
* **`prod_content`**: Descrieri și Titluri optimizate SEO.
* **`prod_channel_mappings`**: Legături ID cu platformele externe.

---

## 3. Strategia de Normalizare (Attribute Registry)

Pentru a evita poluarea bazei de date cu atribute duplicat:

1. **Lookup:** Căutăm atributul extras în sinonime (`prod_attr_synonyms`).
2. **Vector Match:** Dacă nu există, folosim `pgvector` pentru a căuta semantic în definiții.
3. **Threshold:**
    * `Score > 95%`: Auto-link.
    * `Score < 95%`: Flag "New Attribute Proposal" -> Human Review.

---

## 4. Consens și Anti-Hallucination

Pentru produse critice, aplicăm **Trei Sesiuni de Validare**:

1. Agent 1 extrage Datele.
2. Agent 2 extrage Datele.
3. Agent 3 extrage Datele.
4. **Arbiterul** compară JSON-urile.
    * Valoarea majoritară câștigă.
    * Datele cu `source_snippet` lipsă sunt anulate.

---

## 5. Tehnologie

* **Database:** PostgreSQL 18.1 (JSONB + pgvector).
* **Queue:** BullMQ Pro (Workflow: Crawl -> Extract -> Vote -> Merge).
* **Crawlers:** Crawlee (Node.js) + Playwright + Proxy Rotation.
* **AI:** OpenAI GPT-4o-mini (Cost-efficient) pentru extracție, xAI Grok pentru structured extraction, GPT-4o pentru arbitraj.

---

## 6. Etapele Golden Record Strategy (v2.6)

> **Update 2025-12-29:** Alinierea completă între documentație și strategie

### Etapa 1 & 2: Taxonomii (Layer 1 - Governance)

| Tabel | Descriere |
|-------|-----------|
| `prod_taxonomy` | Ierarhie categorii din Shopify Standard Taxonomy |
| `prod_attr_definitions` | Registru atribute canonice (display_size, weight_kg) |
| `prod_attr_synonyms` | Mapping sinonime pentru normalizare automată |

### Etapa 3: Bronze/Silver Records (Layer 2-3)

| Tabel | Descriere |
|-------|-----------|
| `prod_raw_harvest` | Materie primă (HTML/JSON) de la crawlere |
| `prod_extraction_sessions` | Rezultate brute ale agenților AI |
| `prod_master.data_quality_level` | **NOU v2.6** - Tracking nivel calitate: bronze/silver/golden |

### Etapa 4: Broad Search & Similarity Matching

| Tabel | Descriere |
|-------|-----------|
| `prod_similarity_matches` | **NOU v2.6** - Matches externe (95-100% similarity) |
| `prod_sources` | Configurare surse externe (Google, eMag, suppliers) |
| `api_usage_log` | **NOU v2.6** - Tracking costuri API (Google, xAI) |

**Documentație API:** `External_Product_APIs_Integration.md`

### Etapa 5: Consensus & Compilation

| Tabel | Descriere |
|-------|-----------|
| `prod_proposals` | Date consolidate în așteptarea votului final |
| `prod_specs_normalized` | Specificații tehnice normalizate cu provenance |

**Algoritm Consensus:**
- Multi-source voting (min 2 surse pentru accept)
- Weight by trust_score × similarity_score
- Conflict resolution cu flags pentru human review

### Etapa 6: Golden Record & Events

| Tabel | Descriere |
|-------|-----------|
| `prod_master` | Golden Records cu `data_quality_level = 'golden'` |
| `prod_quality_events` | **NOU v2.6** - Audit trail pentru promovări/demotări |

**Threshold Promovare:**
- Bronze → Silver: quality_score ≥ 0.6, min 2 surse, brand + category
- Silver → Golden: quality_score ≥ 0.85, min 3 surse, GTIN + brand + MPN + category, min 5 specs

---

## 7. Materialized Views pentru Monitoring

| MV | Purpose | Refresh |
|----|---------|---------|
| `mv_pim_quality_progress` | Distribuție bronze/silver/golden | Hourly |
| `mv_pim_enrichment_status` | Status enrichment per level | Hourly |
| `mv_pim_source_performance` | Performanță per sursă externă | Daily |

---

## 8. Referințe Documentație

| Document | Conținut |
|----------|----------|
| `Database_Schema_Complete.md` v2.6 | Schema completă 66 tabele + 7 MVs |
| `External_Product_APIs_Integration.md` v1.0 | Google APIs, xAI Grok, rate limiting |
| `Plan_de_implementare.md` F8.4 | 10 task-uri Golden Record (PR-057 → PR-066) |
| `Arhitectura Baza de Date PostgreSQL Detaliata.md` | Detalii tehnice PostgreSQL 18.1 |

---

## 9. Sprint 8 - Golden Record Implementation (ÎNAINTE de Production!)

> **Timeline:** Săptămâna 8
> **IMPORTANT:** Acest sprint trebuie completat ÎNAINTE de Sprint 9 (Production)!

| PR | Tasks | Focus |
|----|-------|-------|
| PR-045 | F8.4.1 | Google Custom Search API |
| PR-046 | F8.4.2 | prod_similarity_matches CRUD |
| PR-047 | F8.4.3 | xAI Grok structured extraction |
| PR-048 | F8.4.4 | BullMQ enrichment queue |
| PR-049 | F8.4.5 | Multi-source consensus engine |
| PR-050 | F8.4.6 | Quality level promotion logic |
| PR-051 | F8.4.7 | API cost tracking |
| PR-052 | F8.4.8 | PIM progress MVs |
| PR-053 | F8.4.9 | Quality events webhooks |
| PR-054 | F8.4.10 | Playwright scraper fallback |

> **Notă:** Sprint 9 (PR-055 → PR-066) = Production & CI/CD - ULTIMUL sprint!
