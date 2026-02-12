# External Product APIs Integration Guide

> **Version:** 1.0  
> **Date:** 2025-12-29  
> **Purpose:** Documentation for external product search and enrichment APIs used in the Golden Record PIM strategy

---

## Table of Contents

1. [Overview](#overview)
2. [Google Product APIs](#google-product-apis)
3. [xAI Grok API for Structured Data](#xai-grok-api-for-structured-data)
4. [Alternative Sources](#alternative-sources)
5. [Rate Limiting & Cost Management](#rate-limiting--cost-management)
6. [Data Flow Architecture](#data-flow-architecture)
7. [Implementation Tasks](#implementation-tasks)

---

## Overview

### Golden Record Strategy - Stage 4

Această documentație acoperă **Etapa 4** din strategia PIM pentru Golden Records:

> **"Broad search/research de produse similare cu similaritate 95-100% și colectarea/scraping de informații și atribute"**

### Obiective

1. **Identificare produse similare** - Găsirea acelorași produse pe alte platforme (95-100% match)
2. **Colectare atribute** - Extragerea specificațiilor tehnice din surse externe
3. **Validare și îmbogățire** - Confirmarea și completarea datelor locale cu informații externe
4. **Construire Golden Record** - Compilarea informațiilor din multiple surse într-un record de calitate maximă

---

## Similarity Match Triage (F8.4.2)

Acest modul introduce un **sistem de triaj pe praguri** pentru validarea match-urilor externe:

| Similarity Score | Acțiune | Detalii |
| ---------------- | ------ | ------- |
| **>= 0.98** | Auto-approve | Match confirmat automat |
| **0.94 - 0.98** | AI Auditor | xAI Grok validează critic datele |
| **0.90 - 0.94** | HITL | Review uman obligatoriu |
| **< 0.90** | Reject | Nu se salvează în `prod_similarity_matches` |

### AI Auditor (xAI Grok)

Pentru matches între **94-98%**, se folosește un **AI Auditor** care:

- Verifică dacă este același produs fizic
- Evaluează dacă datele sunt utilizabile pentru enrichment
- Decide: **approve**, **reject** sau **escalate_to_human**
- Salvează reasoning și discrepanțe în `match_details`

Configurarea xAI se face din pagina **Settings → xAI Grok** (configurare API key, model, rate limit, budget).

---

## Google Product APIs

### 1. Serper API (Recomandat)

> **Use Case:** Căutare programatică de produse pe web (înlocuiește Google Custom Search)

#### Configurare

```bash
# Environment variables necesare
SERPER_API_KEY=your-serper-api-key
```

#### Endpoint

``` bash
POST https://google.serper.dev/search
```

#### Parametri Relevanți

| Parametru | Tip    | Descriere                                     |
|-----------|--------|-----------------------------------------------|
| `q`       | string | Query: "{brand} {mpn}" sau "{gtin}"           |
| `num`     | int    | Rezultate per request (max 10)                |
| `gl`      | string | Country code (ex: "ro")                       |
| `hl`      | string | Language (ex: "ro")                           |
| `type`    | string | "search" (default) sau "shopping"             |

#### Exemplu Request

```typescript
// packages/pim/src/services/serper-search.ts
import { z } from 'zod';

const SerperResponseSchema = z.object({
  organic: z.array(z.object({
    title: z.string(),
    link: z.string().url(),
    snippet: z.string().optional(),
    position: z.number(),
  })).default([]),
  shopping: z.array(z.object({
    title: z.string(),
    link: z.string().url(),
    price: z.string().optional(),
    source: z.string().optional(),
  })).optional(),
});

export async function searchProductByGTIN(gtin: string): Promise<ProductSearchResult[]> {
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: gtin,
      num: 10,
      gl: 'ro',
      hl: 'ro',
      type: 'search',
    }),
  });

  const data = SerperResponseSchema.parse(await response.json());
  return data.organic.map(item => ({
    title: item.title,
    url: item.link,
    snippet: item.snippet,
  }));
}
```

#### Pricing & Limits

| Tier | Requests | Cost             |
|------|----------|------------------|
| Free | 2500     | $0               |
| Paid | 1000+    | ~$1/1000 queries |

> **Recomandare:** Folosește caching agresiv (24h TTL) pentru reducerea costurilor.

---

### 2. Google Shopping Content API (Merchant Center)

> **Use Case:** Acces la feed-uri de produse pentru comparație

#### Notă Importantă

Acest API necesită un cont Google Merchant Center activ. Este util pentru:

- Verificarea produselor proprii publicate
- Comparație cu competitorii (dacă aveți acces)

> **Nu este recomandat pentru:**

- Scraping de produse ale altor comercianți (ToS violation)
- Căutări de produse externe

---

### 3. Google Vision AI - Product Search

> **Use Case:** Căutare vizuală de produse similare pe bază de imagine

#### Configurare GV AI

```bash
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=europe-west1
GOOGLE_CLOUD_PRODUCT_SET_ID=neanelu-products
```

#### Flow

1. **Indexare:** Încărcați imaginile produselor în Google Cloud Vision Product Set
2. **Căutare:** Trimiteți o imagine → primiți produse similare vizual
3. **Matching:** Identificați produse identice pe alte platforme

#### Exemplu

```typescript
import { ProductSearchClient } from '@google-cloud/vision';

const client = new ProductSearchClient();

export async function searchSimilarProducts(imageUri: string) {
  const [response] = await client.batchAnnotateImages({
    requests: [{
      image: { source: { imageUri } },
      features: [{ type: 'PRODUCT_SEARCH' }],
      imageContext: {
        productSearchParams: {
          productSet: `projects/${PROJECT}/locations/${LOCATION}/productSets/${SET_ID}`,
          productCategories: ['general-v1'],
        },
      },
    }],
  });
  
  return response.responses[0].productSearchResults?.results ?? [];
}
```

#### Pricing

- $1.50 / 1,000 images (Product Search)
- Indexing: $0.05 / 1,000 products / month

---

## xAI Grok API for Structured Data

### Avantaje pentru Scraping Inteligent

| Caracteristică         | Descriere                                       |
|------------------------|-------------------------------------------------|
| **Structured Output**  | Native JSON schema enforcement                  |
| **Accuracy**           | 95%+ pe date factuale despre produse            |
| **Hallucination Rate** | <2% pentru extracție de atribute                |
| **Rate Limit**         | până la 480 RPM (modelele Grok Fast)            |
| **Cost**               | vezi tabelul oficial de pricing (per 1M tokens) |

> **Notă (update 2026-01-21):** Pricing-ul xAI publicat în docs include modele Grok Fast cu **$0.20 / 1M input** și **$0.50 / 1M output** (ex. `grok-4-1-fast-*`), limite de **4M TPM** și **480 RPM**. Modelele standard (ex. `grok-3`) sunt mai scumpe. Sursa oficială: [https://docs.x.ai/docs/models](https://docs.x.ai/docs/models)

### Configurare xAI

```bash
XAI_API_KEY=xai-your-api-key
XAI_BASE_URL=https://api.x.ai/v1
```

### Schema pentru Extracție Produs

```typescript
// packages/pim/src/schemas/product-extraction.ts
import { z } from 'zod';

export const ExtractedProductSchema = z.object({
  title: z.string().describe('Titlul complet al produsului'),
  brand: z.string().optional().describe('Marca/Brandul'),
  mpn: z.string().optional().describe('Manufacturer Part Number'),
  gtin: z.string().optional().describe('GTIN/EAN/UPC 8-14 cifre'),
  category: z.string().optional().describe('Categoria produsului'),
  
  specifications: z.array(z.object({
    name: z.string().describe('Numele atributului'),
    value: z.string().describe('Valoarea atributului'),
    unit: z.string().optional().describe('Unitatea de măsură'),
  })).describe('Lista de specificații tehnice'),
  
  price: z.object({
    amount: z.number().optional(),
    currency: z.string().default('RON'),
    is_promotional: z.boolean().default(false),
  }).optional(),
  
  images: z.array(z.string().url()).default([]),
  
  confidence: z.object({
    overall: z.number().min(0).max(1).describe('Confidence score 0-1'),
    fields_uncertain: z.array(z.string()).default([]),
  }),
});

export type ExtractedProduct = z.infer<typeof ExtractedProductSchema>;
```

### Implementare Extracție

```typescript
// packages/pim/src/services/xai-extractor.ts
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { ExtractedProductSchema } from '../schemas/product-extraction';

const xai = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: process.env.XAI_BASE_URL,
});

export async function extractProductFromHTML(
  html: string, 
  sourceUrl: string
): Promise<ExtractedProduct> {
  const response = await xai.beta.chat.completions.parse({
    model: 'grok-4-1-fast-non-reasoning',  // cost redus, RPM/TPM mari
    messages: [
      {
        role: 'system',
        content: `Ești un expert în extracția structurată a datelor despre produse din pagini web.
        
Reguli stricte:
- Extrage DOAR informații care apar explicit în HTML
- NU inventa sau presupune valori
- Dacă un câmp nu există, lasă-l null/undefined
- Pentru GTIN/EAN verifică să aibă 8-14 cifre
- Confidence < 0.8 dacă informațiile sunt ambigue`
      },
      {
        role: 'user',
        content: `Extrage informațiile despre produs din acest HTML:

URL sursă: ${sourceUrl}

HTML:
${html.slice(0, 50000)}` // Limitare tokens
      }
    ],
    response_format: zodResponseFormat(ExtractedProductSchema, 'product'),
    temperature: 0.1, // Low temperature pentru consistență
  });

  return response.choices[0].message.parsed!;
}
```

### Strategii Anti-Hallucination

| Strategie                  | Implementare                                      |
| -------------------------- | ------------------------------------------------- |
| **Low Temperature**        | `temperature: 0.1` pentru răspunsuri deterministe |
| **Explicit Instructions**  | "NU inventa valori" în system prompt              |
| **Confidence Scoring**     | Model-ul raportează încrederea per câmp           |
| **Post-Validation**        | Verificare GTIN cu algoritm checksum              |
| **Multi-Source Consensus** | Validare încrucișată din 3+ surse                 |

### Cost Estimation pentru 1.77M Produse

| Scenariu                                    | Input Tokens | Output Tokens | Cost Total           |
| ------------------------------------------- | ------------ | ------------- | -------------------- |
| 1 request/produs (avg 5K input, 500 output) | 8.85B        | 885M          | **depinde de model** |
| Cu caching (50% hit rate)                   | 4.43B        | 442M          | **depinde de model** |
| Batch processing (model fast)               | 4.43B        | 442M          | **depinde de model** |

> **Recomandare:** Folosiți un model **fast** pentru extracții în masă și un model mai puternic pentru validări critice.

---

## OpenAI GPT API – Pricing (referință oficială)

Prețurile sunt per **1M tokens** și depind de model + tier (Standard/Flex/Priority). Tabel complet: [https://platform.openai.com/docs/pricing](https://platform.openai.com/docs/pricing)

**Exemple (Standard):**

- `gpt-4o-mini`: $0.15 / 1M input, $0.60 / 1M output
- `gpt-5.2`: $1.75 / 1M input, $14.00 / 1M output

**Observație:** pentru costuri predictibile la scară mare, folosiți Batch API / Flex tier când latența permite.

---

## DeepSeek API – Pricing (referință oficială)

**deepseek-chat / deepseek-reasoner (V3.2):**

- 1M input tokens (cache hit): **$0.028**
- 1M input tokens (cache miss): **$0.28**
- 1M output tokens: **$0.42**

Sursa oficială: [https://api-docs.deepseek.com/quick_start/pricing](https://api-docs.deepseek.com/quick_start/pricing)

---

## Alternative Sources

### 1. Open Product Data APIs

| Sursă                 | API  | Acces    | Best For         |
|-----------------------|------|----------|------------------|
| **Open EAN**          | REST | Gratuit  | GTIN lookups     |
| **UPCitemdb**         | REST | Freemium | Barcode database |
| **Barcodelookup.com** | REST | Paid     | Comprehensive    |
| **Open Food Facts**   | REST | Gratuit  | Food products    |

### 2. Marketplace APIs

| Marketplace    | API Disponibil          | Note                            |
|----------------|-------------------------|---------------------------------|
| **eMag**       | Partner API             | Necesită contract parteneriat   |
| **Amazon**     | Product Advertising API | Rate limited, complexitate mare |
| **AliExpress** | Affiliate API           | Bun pentru produse chinezești   |

### 3. Web Scraping (Fallback)

```typescript
// packages/scraper/src/scrapers/generic.ts
export async function scrapeProductPage(url: string): Promise<RawHarvest> {
  // Folosim Playwright pentru rendering JS
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto(url, { waitUntil: 'networkidle' });
  
  // Extrage structured data (Schema.org)
  const jsonLd = await page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    return Array.from(scripts).map(s => JSON.parse(s.textContent || '{}'));
  });
  
  const html = await page.content();
  await browser.close();
  
  return { url, html, jsonLd, fetchedAt: new Date() };
}
```

---

## Rate Limiting & Cost Management

### BullMQ Rate Limiter Integration

```typescript
// packages/pim/src/queues/enrichment-queue.ts
import { Queue, Worker, RateLimiter } from 'bullmq';

const enrichmentQueue = new Queue('pim-enrichment', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 1000 },
  },
});

// Rate limiters per source
const rateLimiters = {
  google: new RateLimiter({ max: 10, duration: 1000 }),  // 10 req/sec
  xai: new RateLimiter({ max: 60, duration: 60000 }),    // 60 req/min
  emag: new RateLimiter({ max: 5, duration: 1000 }),     // 5 req/sec
};
```

### Cost Tracking

```sql
-- Tabel pentru tracking costuri API
CREATE TABLE api_usage_log (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  api_provider VARCHAR(50) NOT NULL,  -- google/xai/emag
  endpoint VARCHAR(100) NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  tokens_input INTEGER,
  tokens_output INTEGER,
  estimated_cost DECIMAL(10,4),
  job_id VARCHAR(255),
  product_id UUID REFERENCES prod_master(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_api_usage_provider_date ON api_usage_log(api_provider, created_at);

-- View pentru daily costs
CREATE VIEW v_api_daily_costs AS
SELECT 
  DATE(created_at) as date,
  api_provider,
  SUM(request_count) as total_requests,
  SUM(tokens_input) as total_input_tokens,
  SUM(tokens_output) as total_output_tokens,
  SUM(estimated_cost) as total_cost
FROM api_usage_log
GROUP BY DATE(created_at), api_provider;
```

---

## Data Flow Architecture

```mermaid
┌─────────────────────────────────────────────────────────────────────┐
│                        BROAD SEARCH PIPELINE                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐         │
│  │ prod_master  │────▶│ BullMQ Queue │────▶│ Google API   │         │
│  │ (bronze)     │     │ enrichment   │     │ Search       │         │
│  └──────────────┘     └──────────────┘     └──────────────┘         │
│        │                     │                    │                 │
│        │                     │                    ▼                 │
│        │                     │           ┌──────────────┐           │
│        │                     │           │ Scrapers     │           │
│        │                     │           │ (Playwright) │           │
│        │                     │           └──────────────┘           │
│        │                     │                    │                 │
│        │                     │                    ▼                 │
│        │                     │           ┌──────────────┐           │
│        │                     └──────────▶│ prod_raw_    │           │
│        │                                 │ harvest      │           │
│        │                                 └──────────────┘           │
│        │                                        │                   │
│        │                                        ▼                   │
│        │                                ┌──────────────┐            │
│        │                                │ xAI Grok     │            │
│        │                                │ Extraction   │            │
│        │                                └──────────────┘            │
│        │                                        │                   │
│        │                                        ▼                   │
│        │    ┌───────────────────────────────────────────────────┐   │
│        │    │              prod_similarity_matches              │   │
│        │    │  (source_url, similarity_score, specs_extracted)  │   │
│        └───▶│                                                   │   │
│             └───────────────────────────────────────────────────┘   │
│                                    │                                │
│                                    ▼                                │
│             ┌───────────────────────────────────────────────────┐   │
│             │              CONSENSUS ENGINE                     │   │
│             │  - Multi-source attribute voting                  │   │
│             │  - Confidence scoring                             │   │
│             │  - Conflict resolution                            │   │
│             └───────────────────────────────────────────────────┘   │
│                                    │                                │
│                                    ▼                                │
│             ┌───────────────────────────────────────────────────┐   │
│             │         prod_master.data_quality_level            │   │
│             │              bronze → silver → golden             │   │
│             └───────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Implementation Tasks

### Fază 8: External Product Search Integration

| Task ID | Descriere                                            | Sprint | PR     | Dependențe   |
|---------|------------------------------------------------------|--------|--------|--------------|
| F8.4.1  | Serper API integration                               | **S8** | PR-TBD | F2.2.1, F6.1 |
| F8.4.2  | prod_similarity_matches CRUD & business logic.       | **S8** | PR-046 | F8.4.1       |
| F8.4.3  | xAI Grok structured extraction service               | **S8** | PR-047 | F8.4.2       |
| F8.4.4  | BullMQ enrichment queue with rate limiting           | **S8** | PR-048 | F8.4.3.      |
| F8.4.5  | Multi-source consensus engine                        | **S8** | PR-049 | F8.4.4       |
| F8.4.6  | Quality level promotion logic (bronze→silver→golden) | **S8** | PR-050 | F8.4.5       |
| F8.4.7  | API cost tracking & budget alerts                    | **S8** | PR-051 | F8.4.4       |
| F8.4.8  | PIM progress dashboard MVs                           | **S8** | PR-052 | F8.4.6.      |
| F8.4.9  | Quality events webhook system                        | **S8** | PR-053 | F8.4.6       |
| F8.4.10 | Playwright scraper fallback                          | **S8** | PR-054 | F8.4.4       |

> **IMPORTANT:** Sprint 8 = Golden Record Strategy. Sprint 9 = Production (FINAL).

---

## References

- [Google Custom Search JSON API](https://developers.google.com/custom-search/v1/overview)
- [Google Vision AI Product Search](https://cloud.google.com/vision/product-search/docs)
- [xAI Grok API Documentation](https://docs.x.ai/)
- [Structured Outputs with Zod](https://sdk.vercel.ai/docs/guides/structured-outputs)
- [BullMQ Rate Limiting](https://docs.bullmq.io/guide/rate-limiting)

---

## Changelog

| Version | Date       | Changes                             |
|---------|------------|-------------------------------------|
| 1.0     | 2025-12-29 | Initial documentation pentru Gap #3 |

---

## F8.4.7 - API Cost Tracking and Budget Alerts

Implemented scope:

- Unified usage logging in `api_usage_log` for `serper`, `xai`, `openai`.
- Per-shop budget settings in `shop_ai_credentials` including:
  - `serper_daily_budget`, `serper_budget_alert_threshold`
  - `xai_daily_budget`, `xai_budget_alert_threshold`
  - `openai_daily_budget`, `openai_budget_alert_threshold`, `openai_items_daily_budget`
- Unified budget status view: `v_api_budget_status`.
- Application-level budget enforcement (`BudgetGuard`) with hard-stop at 100%.
- Daily auto-resume scheduler for enrichment queue.
- Weekly summary generation with in-app notifications (`pim_notifications`) and optional webhook.
- Admin endpoints for:
  - budget status
  - queue pause/resume
  - budget updates
