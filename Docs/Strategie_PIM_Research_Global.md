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
* **Crawlers:** Crawlee (Node.js) + Proxy Rotation.
* **AI:** OpenAI GPT-4o-mini (Cost-efficient) pentru extracție, GPT-4o pentru arbitraj.
