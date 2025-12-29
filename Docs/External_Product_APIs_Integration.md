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

## Google Product APIs

### 1. Google Custom Search JSON API (Recomandat)

> **Use Case:** Căutare programatică de produse pe web

#### Configurare

```bash
# Environment variables necesare
GOOGLE_SEARCH_API_KEY=your-api-key
GOOGLE_SEARCH_ENGINE_ID=your-cx-id  # Programmatic Search Engine ID
```

#### Endpoint

```
GET https://www.googleapis.com/customsearch/v1
```

#### Parametri Relevanți

| Parametru | Tip | Descriere |
|-----------|-----|-----------|
| `key` | string | API Key (obligatoriu) |
| `cx` | string | Search Engine ID (obligatoriu) |
| `q` | string | Query: "{brand} {mpn}" sau "{gtin}" |
| `num` | int | Rezultate per request (max 10) |
| `start` | int | Offset pentru paginare |
| `siteSearch` | string | Limitare la domeniu specific |
| `searchType` | string | "image" pentru căutare imagini |

#### Exemplu Request

```typescript
// packages/pim/src/services/google-search.ts
import { z } from 'zod';

const GoogleSearchResultSchema = z.object({
  items: z.array(z.object({
    title: z.string(),
    link: z.string().url(),
    snippet: z.string().optional(),
    pagemap: z.object({
      product: z.array(z.object({
        name: z.string().optional(),
        brand: z.string().optional(),
        gtin14: z.string().optional(),
        sku: z.string().optional(),
        price: z.string().optional(),
        image: z.string().optional(),
      })).optional(),
    }).optional(),
  })).default([]),
  searchInformation: z.object({
    totalResults: z.string(),
  }).optional(),
});

export async function searchProductByGTIN(gtin: string): Promise<ProductSearchResult[]> {
  const response = await fetch(
    `https://www.googleapis.com/customsearch/v1?` +
    new URLSearchParams({
      key: process.env.GOOGLE_SEARCH_API_KEY!,
      cx: process.env.GOOGLE_SEARCH_ENGINE_ID!,
      q: gtin,
      num: '10',
    })
  );
  
  const data = GoogleSearchResultSchema.parse(await response.json());
  return data.items.map(item => ({
    title: item.title,
    url: item.link,
    snippet: item.snippet,
    structuredData: item.pagemap?.product?.[0],
  }));
}
```

#### Pricing & Limits

| Tier | Requests/Day | Cost |
|------|--------------|------|
| Free | 100 | $0 |
| Paid | 10,000+ | $5/1000 queries |

> **Recomandare:** Pentru 1.77M produse, buget estimat: ~$885 (1 query/produs)

---

### 2. Google Shopping Content API (Merchant Center)

> **Use Case:** Acces la feed-uri de produse pentru comparație

#### Notă Importantă

Acest API necesită un cont Google Merchant Center activ. Este util pentru:
- Verificarea produselor proprii publicate
- Comparație cu competitorii (dacă aveți acces)

#### Nu este recomandat pentru:

- Scraping de produse ale altor comercianți (ToS violation)
- Căutări de produse externe

---

### 3. Google Vision AI - Product Search

> **Use Case:** Căutare vizuală de produse similare pe bază de imagine

#### Configurare

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

| Caracteristică | Descriere |
|----------------|-----------|
| **Structured Output** | Native JSON schema enforcement |
| **Accuracy** | 95%+ pe date factuale despre produse |
| **Hallucination Rate** | <2% pentru extracție de atribute |
| **Rate Limit** | 60 RPM (tier plătit) |
| **Cost** | $5/M input tokens, $15/M output tokens |

### Configurare

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
    model: 'grok-3',  // sau grok-2-1212 pentru cost mai mic
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

| Strategie | Implementare |
|-----------|--------------|
| **Low Temperature** | `temperature: 0.1` pentru răspunsuri deterministe |
| **Explicit Instructions** | "NU inventa valori" în system prompt |
| **Confidence Scoring** | Model-ul raportează încrederea per câmp |
| **Post-Validation** | Verificare GTIN cu algoritm checksum |
| **Multi-Source Consensus** | Validare încrucișată din 3+ surse |

### Cost Estimation pentru 1.77M Produse

| Scenariu | Input Tokens | Output Tokens | Cost Total |
|----------|--------------|---------------|------------|
| 1 request/produs (avg 5K input, 500 output) | 8.85B | 885M | ~$57,525 |
| Cu caching (50% hit rate) | 4.43B | 442M | ~$28,763 |
| Batch processing (grok-2-mini) | 4.43B | 442M | ~$5,753 |

> **Recomandare:** Folosiți `grok-2-mini` pentru extracții în masă, `grok-3` pentru validări critice.

---

## Alternative Sources

### 1. Open Product Data APIs

| Sursă | API | Acces | Best For |
|-------|-----|-------|----------|
| **Open EAN** | REST | Gratuit | GTIN lookups |
| **UPCitemdb** | REST | Freemium | Barcode database |
| **Barcodelookup.com** | REST | Paid | Comprehensive |
| **Open Food Facts** | REST | Gratuit | Food products |

### 2. Marketplace APIs

| Marketplace | API Disponibil | Note |
|-------------|----------------|------|
| **eMag** | Partner API | Necesită contract parteneriat |
| **Amazon** | Product Advertising API | Rate limited, complexitate mare |
| **AliExpress** | Affiliate API | Bun pentru produse chinezești |

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

```
┌─────────────────────────────────────────────────────────────────────┐
│                        BROAD SEARCH PIPELINE                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐        │
│  │ prod_master  │────▶│ BullMQ Queue │────▶│ Google API   │        │
│  │ (bronze)     │     │ enrichment   │     │ Search       │        │
│  └──────────────┘     └──────────────┘     └──────────────┘        │
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
│        │    ┌───────────────────────────────────────────────────┐  │
│        │    │              prod_similarity_matches               │  │
│        │    │  (source_url, similarity_score, specs_extracted)  │  │
│        └───▶│                                                   │  │
│             └───────────────────────────────────────────────────┘  │
│                                    │                                │
│                                    ▼                                │
│             ┌───────────────────────────────────────────────────┐  │
│             │              CONSENSUS ENGINE                      │  │
│             │  - Multi-source attribute voting                   │  │
│             │  - Confidence scoring                              │  │
│             │  - Conflict resolution                             │  │
│             └───────────────────────────────────────────────────┘  │
│                                    │                                │
│                                    ▼                                │
│             ┌───────────────────────────────────────────────────┐  │
│             │         prod_master.data_quality_level             │  │
│             │              bronze → silver → golden              │  │
│             └───────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Tasks

### Fază 8: External Product Search Integration

| Task ID | Descriere | Sprint | Dependențe |
|---------|-----------|--------|------------|
| F8.1.1 | Setup Google Custom Search API integration | S5 | F2.2.1 |
| F8.1.2 | Implementare search by GTIN/MPN/Title | S5 | F8.1.1 |
| F8.1.3 | Create prod_similarity_matches handlers | S5 | F8.1.1 |
| F8.2.1 | xAI Grok structured extraction service | S5 | F6.1 |
| F8.2.2 | Anti-hallucination validation layer | S5 | F8.2.1 |
| F8.2.3 | Confidence scoring per field | S5 | F8.2.1 |
| F8.3.1 | BullMQ enrichment queue with rate limiting | S5 | F3.2 |
| F8.3.2 | Multi-source consensus engine | S6 | F8.2.3 |
| F8.3.3 | Quality level promotion logic (bronze→silver→golden) | S6 | F8.3.2 |
| F8.4.1 | API cost tracking & budget alerts | S5 | F8.1.1 |
| F8.4.2 | PIM progress dashboard MVs | S6 | F8.3.3 |
| F8.4.3 | Quality events webhook system | S6 | F8.3.3 |

---

## References

- [Google Custom Search JSON API](https://developers.google.com/custom-search/v1/overview)
- [Google Vision AI Product Search](https://cloud.google.com/vision/product-search/docs)
- [xAI Grok API Documentation](https://docs.x.ai/)
- [Structured Outputs with Zod](https://sdk.vercel.ai/docs/guides/structured-outputs)
- [BullMQ Rate Limiting](https://docs.bullmq.io/guide/rate-limiting)

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-29 | Initial documentation pentru Gap #3 |
