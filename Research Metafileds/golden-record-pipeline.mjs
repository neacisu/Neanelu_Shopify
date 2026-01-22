/**
 * Golden Record Pipeline - Bronze → Silver → Golden
 *
 * Pipeline complet pentru transformarea produselor în Golden Records:
 * 1. Bronze: Extragere date Shopify
 * 2. Silver: Bronze + date vendor (scrape & extract)
 * 3. Web Search: Silver + căutare Google via Serper.dev
 * 4. Golden: Compilare finală cu AI analysis
 *
 * Cost tracking integrat pentru 900,000+ produse
 *
 * Usage: node golden-record-pipeline.mjs <product-handle>
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import CostTracker, {
  estimateTokens,
  PRICING,
  USD_TO_RON,
} from './golden-record-cost-calculator.mjs';

// Global cost tracker instance
const costTracker = new CostTracker();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// === Configuration ===
const HANDLE = process.argv[2];
if (!HANDLE) {
  console.error('Usage: node golden-record-pipeline.mjs <product-handle>');
  process.exit(1);
}

const API_VERSION = '2025-10';
const envPath = path.resolve(__dirname, '..', '.env');

if (!fs.existsSync(envPath)) {
  console.error('Missing .env in project root:', envPath);
  process.exit(1);
}

// Parse .env
const envRaw = fs.readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envRaw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const cleaned = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed;
  const idx = cleaned.indexOf('=');
  if (idx === -1) continue;
  const key = cleaned.slice(0, idx).trim();
  let val = cleaned.slice(idx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  env[key] = val;
}

const shopDomain =
  env.SHOPIFY_SHOP_DOMAIN || env.SHOPIFY_STORE_DOMAIN || env.SHOPIFY_MYSHOPIFY_DOMAIN || '';
const shopToken =
  env.SHOPIFY_ADMIN_ACCESS_TOKEN || env.SHOPIFY_ACCESS_TOKEN || env.SHOPIFY_ADMIN_API_TOKEN || '';
const deepseekKey = env.DEEPSEEK_API_KEY || '';
const xaiKey = env.XAI_API_KEY || '';
const serperKey = env.SERPER_API_KEY || '';

if (!shopDomain || !shopToken) {
  console.error('Missing Shopify domain/token in .env');
  process.exit(1);
}
if (!deepseekKey && !xaiKey) {
  console.error('Missing DEEPSEEK_API_KEY or XAI_API_KEY in .env (at least one required)');
  process.exit(1);
}

const hasXai = !!xaiKey;
const hasDeepseek = !!deepseekKey;
const hasSerper = !!serperKey;

// === Utility Functions ===

const shopifyQuery = `
query ProductByHandle($query: String!) {
  products(first: 1, query: $query) {
    nodes {
      id
      title
      handle
      vendor
      productType
      status
      description
      descriptionHtml
      tags
      createdAt
      updatedAt
      totalInventory
      variants(first: 50) {
        nodes { id title sku price compareAtPrice inventoryQuantity barcode }
      }
      metafields(first: 250) {
        nodes {
          id namespace key type value jsonValue
          definition { id name }
        }
      }
    }
  }
}
`;

const requestShopify = (body) =>
  new Promise((resolve, reject) => {
    const options = {
      method: 'POST',
      hostname: shopDomain,
      path: `/admin/api/${API_VERSION}/graphql.json`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Shopify-Access-Token': shopToken,
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          // Track Shopify cost (FREE but count requests)
          costTracker.trackShopify({ queryType: 'graphql', cost_points: 1 });

          if (json.errors) reject(new Error(JSON.stringify(json.errors)));
          else resolve(json);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

const fetchHtml = async (url) => {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) {
    costTracker.trackFetch({ url, bytes: 0, success: false });
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  costTracker.trackFetch({ url, bytes: Buffer.byteLength(html), success: true });
  return html;
};

const deepseekRequest = async (messages, temperature = 0.1) => {
  const requestBody = JSON.stringify({
    model: 'deepseek-chat',
    messages,
    temperature,
    stream: false,
  });

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${deepseekKey}`,
    },
    body: requestBody,
  });
  if (!res.ok) {
    const text = await res.text();
    costTracker.trackError('deepseek', `API error: ${res.status}`);
    throw new Error(`DeepSeek API error (${res.status}): ${text}`);
  }
  const json = await res.json();

  // Track real tokens from API response (use response.usage when available)
  const usage = json.usage;
  const inputTokens = usage?.prompt_tokens || estimateTokens(JSON.stringify(messages));
  const outputTokens =
    usage?.completion_tokens || estimateTokens(json.choices?.[0]?.message?.content || '');

  costTracker.trackDeepSeek({
    inputTokens,
    outputTokens,
    usage, // Pass full usage object for precision
    purpose: 'ai_extraction',
  });

  return json;
};

// xAI Grok request with optional web search
const xaiRequest = async (messages, options = {}) => {
  const { temperature = 0.1, webSearch = false } = options;

  const payload = {
    model: 'grok-3', // grok-3 supports web search
    messages,
    temperature,
    stream: false,
  };

  // Enable web search via search_parameters
  if (webSearch) {
    payload.search_parameters = {
      mode: 'auto', // or "on" to force web search
      max_search_results: 10,
      return_citations: true,
    };
  }

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${xaiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    costTracker.trackError('xai', `API error: ${res.status}`);
    throw new Error(`xAI API error (${res.status}): ${text}`);
  }
  const json = await res.json();

  // Track real tokens from API response
  const usage = json.usage;
  const inputTokens = usage?.prompt_tokens || estimateTokens(JSON.stringify(messages));
  const outputTokens =
    usage?.completion_tokens || estimateTokens(json.choices?.[0]?.message?.content || '');

  costTracker.trackXai({
    inputTokens,
    outputTokens,
    usage,
    webSearch,
    purpose: 'web_search_or_ai',
  });

  return json;
};

// Unified AI request - prefers xAI for web search, DeepSeek for extraction
const aiRequest = async (messages, options = {}) => {
  const { temperature = 0.1, webSearch = false, preferXai = false } = options;

  // Use xAI for web search or if preferred and available
  if ((webSearch || preferXai) && hasXai) {
    return await xaiRequest(messages, { temperature, webSearch });
  }

  // Fallback to DeepSeek
  if (hasDeepseek) {
    return await deepseekRequest(messages, temperature);
  }

  throw new Error('No AI provider available');
};

// === SERPER.DEV - Google Search API ===
const serperSearch = async (query, options = {}) => {
  const {
    type = 'search', // search, shopping, images, news
    num = 20,
    gl = 'ro', // country
    hl = 'ro', // language
  } = options;

  const endpoint =
    type === 'shopping'
      ? 'https://google.serper.dev/shopping'
      : type === 'images'
        ? 'https://google.serper.dev/images'
        : type === 'news'
          ? 'https://google.serper.dev/news'
          : 'https://google.serper.dev/search';

  const requestBody = JSON.stringify({ q: query, num, gl, hl });

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': serperKey,
    },
    body: requestBody,
  });

  if (!res.ok) {
    const text = await res.text();
    costTracker.trackError('serper', `API error: ${res.status}`);
    throw new Error(`Serper API error (${res.status}): ${text}`);
  }

  const json = await res.json();

  // Track Serper query cost (1 query per API call)
  costTracker.trackSerper({
    queryCount: 1,
    queryType: type,
    query: query,
  });

  return json;
};

// Comprehensive Google search using Serper
const googleSearchProduct = async (searchContext) => {
  const results = {
    organic: [],
    shopping: [],
    relatedSearches: [],
    knowledgeGraph: null,
    totalResults: 0,
  };

  // Build multiple search queries
  const queries = [];

  // Priority 1: GTIN/EAN (most unique)
  if (searchContext.gtin) {
    queries.push({ query: searchContext.gtin, type: 'gtin' });
  }

  // Priority 2: MPN + Brand
  if (searchContext.mpn && searchContext.brand) {
    queries.push({ query: `${searchContext.mpn} ${searchContext.brand}`, type: 'mpn_brand' });
  } else if (searchContext.mpn) {
    queries.push({ query: searchContext.mpn, type: 'mpn' });
  }

  // Priority 3: Title search (product name)
  if (searchContext.title) {
    // Clean title for search
    const cleanTitle = searchContext.title.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
    queries.push({ query: cleanTitle, type: 'title' });
  }

  console.log(`  Running ${queries.length} Google searches via Serper...`);

  for (const { query, type } of queries) {
    try {
      console.log(`    [${type}] "${query}"`);

      // Organic search
      const organicResp = await serperSearch(query, { type: 'search', num: 15 });

      if (organicResp.organic) {
        for (const item of organicResp.organic) {
          // Avoid duplicates
          if (!results.organic.find((o) => o.link === item.link)) {
            results.organic.push({
              ...item,
              searchType: type,
              searchQuery: query,
            });
          }
        }
      }

      if (organicResp.knowledgeGraph && !results.knowledgeGraph) {
        results.knowledgeGraph = organicResp.knowledgeGraph;
      }

      if (organicResp.relatedSearches) {
        results.relatedSearches.push(...organicResp.relatedSearches.map((r) => r.query));
      }

      // Shopping search (for prices and availability)
      const shoppingResp = await serperSearch(query, { type: 'shopping', num: 10 });

      if (shoppingResp.shopping) {
        for (const item of shoppingResp.shopping) {
          if (!results.shopping.find((s) => s.link === item.link)) {
            results.shopping.push({
              ...item,
              searchType: type,
              searchQuery: query,
            });
          }
        }
      }

      // Small delay between queries to be nice to API
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.log(`    ⚠ Search failed for "${query}": ${err.message}`);
    }
  }

  results.totalResults = results.organic.length + results.shopping.length;
  results.relatedSearches = [...new Set(results.relatedSearches)];

  return results;
};

// Analyze Google results with AI to extract structured data
const analyzeGoogleResults = async (googleResults, searchContext) => {
  const prompt = `Analizează aceste rezultate de căutare Google și extrage informații structurate despre produs.

PRODUS CĂUTAT:
- Titlu: ${searchContext.title}
- Brand: ${searchContext.brand || 'necunoscut'}
- MPN/SKU: ${searchContext.mpn || 'necunoscut'}
- GTIN/EAN: ${searchContext.gtin || 'necunoscut'}

REZULTATE ORGANICE (${googleResults.organic.length} surse):
${JSON.stringify(
  googleResults.organic.slice(0, 15).map((o) => ({
    title: o.title,
    link: o.link,
    snippet: o.snippet,
    domain: new URL(o.link).hostname,
  })),
  null,
  2
)}

REZULTATE SHOPPING (${googleResults.shopping.length} oferte):
${JSON.stringify(
  googleResults.shopping.slice(0, 15).map((s) => ({
    title: s.title,
    source: s.source,
    price: s.price,
    link: s.link,
    rating: s.rating,
    reviews: s.reviews,
  })),
  null,
  2
)}

${
  googleResults.knowledgeGraph
    ? `
KNOWLEDGE GRAPH:
${JSON.stringify(googleResults.knowledgeGraph, null, 2)}
`
    : ''
}

EXTRAGE și returnează JSON:
{
  "product_identity": {
    "confirmed_brand": string | null,
    "confirmed_manufacturer": string | null,
    "confirmed_mpn": string | null,
    "product_line": string | null,
    "original_country": string | null
  },
  "sources_analysis": [
    {
      "url": string,
      "domain": string,
      "source_type": "manufacturer" | "distributor" | "retailer" | "marketplace" | "info",
      "confidence_same_product": number (0-1),
      "extracted_specs": [{"name": string, "value": string, "unit": string|null}],
      "price": {"amount": number|null, "currency": string|null},
      "availability": string | null,
      "description_excerpt": string | null
    }
  ],
  "consolidated_specifications": [
    {
      "name": string,
      "value": string, 
      "unit": string | null,
      "confidence": number,
      "sources_count": number,
      "sources": [string]
    }
  ],
  "market_data": {
    "price_range": {"min": number|null, "max": number|null, "currency": string},
    "retailers_count": number,
    "avg_rating": number | null,
    "total_reviews": number | null,
    "in_stock_count": number
  },
  "related_products": [string],
  "seo_keywords": [string],
  "summary": {
    "total_sources_analyzed": number,
    "high_confidence_sources": number,
    "unique_specs_found": number,
    "data_quality_score": number (0-100)
  }
}

REGULI:
- Doar surse cu confidence >= 0.7
- Prioritizează site-uri producător și distribuitori oficiali
- Consolidează specificațiile găsite în mai multe surse
- Extrage TOATE specificațiile tehnice menționate
- Pentru semințe: caută germinare, puritate, lot, valabilitate, perioada semănat
- Pentru piese tehnice: material, dimensiuni, toleranțe, aplicații`;

  const messages = [
    {
      role: 'system',
      content: `Ești expert în analiza produselor și extragerea datelor structurate din rezultate de căutare.
Analizezi rezultate Google și Shopping pentru a crea o imagine completă a produsului.
Extragi specificații tehnice precise și identifici sursele cele mai credibile.
Răspunzi DOAR cu JSON valid.`,
    },
    { role: 'user', content: prompt },
  ];

  const resp = await aiRequest(messages, { temperature: 0.1 });
  const content = resp?.choices?.[0]?.message?.content || '';
  return parseJsonResponse(content);
};

const parseJsonResponse = (content) => {
  let raw = content;
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) raw = fenced[1].trim();
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const extractMetafield = (metafields, namespace, key) =>
  metafields.find((m) => m.namespace === namespace && m.key === key) || null;

// === STAGE 1: BRONZE - Extract from Shopify ===
const extractBronze = async (handle) => {
  costTracker.startStage('bronze');
  console.log('\n' + '='.repeat(60));
  console.log('STAGE 1: BRONZE - Extracting from Shopify...');
  console.log('='.repeat(60));

  const body = JSON.stringify({
    query: shopifyQuery,
    variables: { query: `handle:${handle}` },
  });

  const resp = await requestShopify(body);
  const product = resp?.data?.products?.nodes?.[0];

  if (!product) {
    throw new Error(`Product not found: ${handle}`);
  }

  const metafields = product.metafields?.nodes ?? [];
  const wholesale = extractMetafield(metafields, 'custom', 'wholesale_product_url');
  const specificatii = extractMetafield(metafields, 'custom', 'specificatii_produs');
  const variant = product.variants?.nodes?.[0];

  const bronze = {
    level: 'bronze',
    source: 'shopify',
    extracted_at: new Date().toISOString(),
    identity: {
      shopify_id: product.id,
      handle: product.handle,
      sku: variant?.sku || null,
      barcode: variant?.barcode || null,
    },
    basic: {
      title: product.title,
      vendor: product.vendor,
      product_type: product.productType,
      status: product.status,
      tags: product.tags || [],
    },
    content: {
      description: product.description,
      description_html: product.descriptionHtml,
    },
    pricing: {
      price: variant?.price ? parseFloat(variant.price) : null,
      compare_at_price: variant?.compareAtPrice ? parseFloat(variant.compareAtPrice) : null,
      currency: 'RON',
    },
    inventory: {
      total: product.totalInventory,
      variant_quantity: variant?.inventoryQuantity || 0,
    },
    specifications: specificatii?.jsonValue || {},
    urls: {
      wholesale_url: wholesale?.value || null,
    },
    raw_metafields: metafields,
  };

  console.log(`✓ Bronze extracted: ${bronze.basic.title}`);
  console.log(`  SKU: ${bronze.identity.sku || 'N/A'}`);
  console.log(`  Vendor: ${bronze.basic.vendor}`);
  console.log(`  Wholesale URL: ${bronze.urls.wholesale_url ? 'Yes' : 'No'}`);

  costTracker.endStage('bronze');
  return bronze;
};

// === STAGE 2: SILVER - Add Vendor Data ===
const extractSilver = async (bronze) => {
  costTracker.startStage('silver');
  console.log('\n' + '='.repeat(60));
  console.log('STAGE 2: SILVER - Enriching with Vendor Data...');
  console.log('='.repeat(60));

  if (!bronze.urls.wholesale_url) {
    console.log('⚠ No wholesale URL found. Silver = Bronze.');
    costTracker.endStage('silver');
    return { ...bronze, level: 'silver', vendor_data: null };
  }

  console.log(`Fetching vendor page: ${bronze.urls.wholesale_url}`);
  let html;
  try {
    html = await fetchHtml(bronze.urls.wholesale_url);
  } catch (err) {
    console.log(`⚠ Failed to fetch vendor page: ${err.message}`);
    costTracker.endStage('silver');
    return { ...bronze, level: 'silver', vendor_data: null };
  }

  console.log(`Vendor page fetched: ${html.length} characters`);
  console.log('Extracting structured data with AI...');

  const schemaInstruction = `Extract product data from the HTML. Return ONLY valid JSON:
{
  "title": string | null,
  "brand": string | null,
  "manufacturer": string | null,
  "mpn": string | null (Manufacturer Part Number),
  "gtin": string | null (EAN/UPC 8-14 digits),
  "category": string | null,
  "specifications": [{"name": string, "value": string, "unit": string | null}],
  "dimensions": {"length": number|null, "width": number|null, "height": number|null, "weight": number|null, "unit": string|null},
  "materials": string[] (materials used),
  "applications": string[] (use cases, compatible with),
  "price": {"amount": number|null, "currency": string|null},
  "images": string[] (image URLs),
  "availability": string | null,
  "confidence": {"overall": number 0-1, "uncertain_fields": string[]}
}

RULES:
- Extract ONLY facts present in HTML
- DO NOT invent or assume values
- GTIN must be 8-14 digits only
- For specifications, extract ALL technical attributes you find
- Images should be absolute URLs when possible`;

  const messages = [
    {
      role: 'system',
      content:
        'You are a product data extraction expert. Extract structured data from HTML. Never invent data.',
    },
    {
      role: 'user',
      content: `Product context from our store:
Title: ${bronze.basic.title}
SKU: ${bronze.identity.sku}
Vendor: ${bronze.basic.vendor}
Type: ${bronze.basic.product_type}
Existing specs: ${JSON.stringify(bronze.specifications)}

Vendor page HTML (truncated):
${html.slice(0, 50000)}

${schemaInstruction}`,
    },
  ];

  const dsResp = await aiRequest(messages, { temperature: 0.1 });
  const content = dsResp?.choices?.[0]?.message?.content || '';
  const vendorData = parseJsonResponse(content);

  if (!vendorData) {
    console.log('⚠ Failed to parse vendor data extraction');
    return { ...bronze, level: 'silver', vendor_data: null, vendor_raw: content };
  }

  console.log(
    `✓ Vendor data extracted with confidence: ${vendorData.confidence?.overall || 'N/A'}`
  );
  console.log(`  Brand: ${vendorData.brand || 'N/A'}`);
  console.log(`  MPN: ${vendorData.mpn || 'N/A'}`);
  console.log(`  GTIN: ${vendorData.gtin || 'N/A'}`);
  console.log(`  Specs found: ${vendorData.specifications?.length || 0}`);

  // Merge bronze + vendor data
  const silver = {
    ...bronze,
    level: 'silver',
    vendor_data: vendorData,
    merged: {
      title: vendorData.title || bronze.basic.title,
      brand: vendorData.brand || bronze.basic.vendor,
      manufacturer: vendorData.manufacturer || null,
      mpn: vendorData.mpn || bronze.identity.sku,
      gtin: vendorData.gtin || bronze.identity.barcode,
      category: vendorData.category || bronze.basic.product_type,
      specifications: mergeSpecifications(bronze.specifications, vendorData.specifications || []),
      dimensions: vendorData.dimensions || null,
      materials: vendorData.materials || [],
      applications: vendorData.applications || [],
      images: vendorData.images || [],
    },
  };

  costTracker.endStage('silver');
  return silver;
};

// Helper: merge specs from bronze and vendor
const mergeSpecifications = (bronzeSpecs, vendorSpecs) => {
  const merged = {};

  // Add bronze specs (from metafield JSON)
  if (bronzeSpecs && typeof bronzeSpecs === 'object') {
    for (const [key, value] of Object.entries(bronzeSpecs)) {
      const cleanKey = key.replace(/:$/, '').trim().toLowerCase();
      merged[cleanKey] = { value, source: 'shopify' };
    }
  }

  // Add/override with vendor specs
  for (const spec of vendorSpecs) {
    const cleanKey = spec.name.toLowerCase().trim();
    merged[cleanKey] = {
      value: spec.value,
      unit: spec.unit || null,
      source: 'vendor',
    };
  }

  return merged;
};

// === STAGE 3: WEB SEARCH - Find Similar Products ===
// Uses Serper.dev (Google Search API) when available, falls back to xAI Grok
const webSearchProducts = async (silver) => {
  costTracker.startStage('web_search');
  console.log('\n' + '='.repeat(60));
  console.log('STAGE 3: WEB SEARCH - Finding Similar Products...');
  console.log('='.repeat(60));

  const searchContext = {
    title: silver.merged?.title || silver.basic.title,
    brand: silver.merged?.brand || silver.basic.vendor,
    mpn: silver.merged?.mpn || silver.identity.sku,
    gtin: silver.merged?.gtin,
    category: silver.merged?.category || silver.basic.product_type,
  };

  console.log('Building search queries...');
  console.log(`  GTIN: ${searchContext.gtin || 'N/A'}`);
  console.log(`  MPN: ${searchContext.mpn}`);
  console.log(`  Title: ${searchContext.title}`);
  console.log(`  Brand: ${searchContext.brand || 'N/A'}`);

  // === TRY SERPER.DEV FIRST (Google Search API) ===
  if (hasSerper) {
    console.log('\n📍 Using Serper.dev (Google Search API)...');

    try {
      const googleResults = await googleSearchProduct(searchContext);

      console.log(`\n✓ Google Search Complete`);
      console.log(`  Organic results: ${googleResults.organic.length}`);
      console.log(`  Shopping results: ${googleResults.shopping.length}`);
      console.log(`  Related searches: ${googleResults.relatedSearches.length}`);

      if (googleResults.organic.length > 0) {
        console.log('\n  Top organic sources:');
        for (const src of googleResults.organic.slice(0, 5)) {
          try {
            const domain = new URL(src.link).hostname;
            console.log(`    - ${domain}: ${src.title.substring(0, 50)}...`);
          } catch {
            console.log(`    - ${src.title.substring(0, 60)}...`);
          }
        }
      }

      if (googleResults.shopping.length > 0) {
        console.log('\n  Top shopping offers:');
        for (const shop of googleResults.shopping.slice(0, 5)) {
          console.log(`    - ${shop.source}: ${shop.price || 'N/A'}`);
        }
      }

      // Analyze results with AI
      console.log('\n  Analyzing results with AI...');
      const analyzedResults = await analyzeGoogleResults(googleResults, searchContext);

      if (analyzedResults) {
        console.log(`\n✓ AI Analysis Complete`);
        console.log(`  Sources analyzed: ${analyzedResults.summary?.total_sources_analyzed || 0}`);
        console.log(`  High confidence: ${analyzedResults.summary?.high_confidence_sources || 0}`);
        console.log(
          `  Unique specs found: ${analyzedResults.summary?.unique_specs_found || analyzedResults.consolidated_specifications?.length || 0}`
        );
        console.log(`  Data quality score: ${analyzedResults.summary?.data_quality_score || 0}%`);

        if (analyzedResults.product_identity?.confirmed_manufacturer) {
          console.log(
            `  Manufacturer confirmed: ${analyzedResults.product_identity.confirmed_manufacturer}`
          );
        }

        if (analyzedResults.market_data?.price_range?.min) {
          console.log(
            `  Price range: ${analyzedResults.market_data.price_range.min}-${analyzedResults.market_data.price_range.max} ${analyzedResults.market_data.price_range.currency}`
          );
        }

        costTracker.endStage('web_search');
        return {
          ...silver,
          search_provider: 'serper',
          google_results: {
            organic_count: googleResults.organic.length,
            shopping_count: googleResults.shopping.length,
            related_searches: googleResults.relatedSearches,
            knowledge_graph: googleResults.knowledgeGraph,
          },
          web_search_results: {
            sources_found: analyzedResults.sources_analysis || [],
            consolidated_specs: analyzedResults.consolidated_specifications || [],
            manufacturer_data: analyzedResults.product_identity || {},
            market_data: analyzedResults.market_data || {},
            search_summary: analyzedResults.summary || {},
            seo_keywords: analyzedResults.seo_keywords || [],
            related_products: analyzedResults.related_products || [],
          },
          web_citations: googleResults.organic.map((o) => o.link).slice(0, 20),
        };
      }
    } catch (err) {
      console.log(`⚠ Serper search failed: ${err.message}`);
      console.log('  Falling back to xAI Grok...');
    }
  }

  // === FALLBACK TO XAI GROK ===
  if (!hasXai) {
    console.log('⚠ No search provider available.');
    console.log('  Add SERPER_API_KEY (recommended) or XAI_API_KEY to .env');
    costTracker.endStage('web_search');
    return { ...silver, web_search_results: null };
  }

  console.log('\n📍 Using xAI Grok web search...');

  // Build search query prioritizing unique identifiers
  let searchQuery = '';
  if (searchContext.gtin) {
    searchQuery = searchContext.gtin;
  } else if (searchContext.mpn) {
    searchQuery = `${searchContext.mpn} ${searchContext.brand || ''}`.trim();
  } else {
    searchQuery = searchContext.title;
  }

  console.log(`  Query: "${searchQuery}"`);

  const webSearchPrompt = `Search the web for this product and find IDENTICAL or 98-100% similar products.

Product:
- GTIN/EAN: ${searchContext.gtin || 'unknown'}
- MPN/SKU: ${searchContext.mpn || 'unknown'}  
- Title: ${searchContext.title}
- Brand: ${searchContext.brand || 'unknown'}

Return JSON:
{
  "sources_found": [{"url": string, "domain": string, "match_confidence": number, "specifications": [{"name": string, "value": string}]}],
  "consolidated_specs": [{"name": string, "value": string, "unit": string|null, "confidence": number}],
  "manufacturer_data": {"name": string|null, "part_number": string|null},
  "search_summary": {"total_sources": number, "high_confidence_matches": number, "new_specs_found": number}
}`;

  try {
    const xaiResp = await xaiRequest(
      [
        { role: 'system', content: 'Product research expert. Return ONLY valid JSON.' },
        { role: 'user', content: webSearchPrompt },
      ],
      { temperature: 0.2, webSearch: true }
    );

    const content = xaiResp?.choices?.[0]?.message?.content || '';
    const citations = xaiResp?.citations || [];
    const webResults = parseJsonResponse(content);

    if (webResults) {
      console.log(`\n✓ xAI Web Search Complete`);
      console.log(`  Sources: ${webResults.sources_found?.length || 0}`);
      console.log(`  Specs found: ${webResults.consolidated_specs?.length || 0}`);

      costTracker.endStage('web_search');
      return {
        ...silver,
        search_provider: 'xai',
        web_search_results: webResults,
        web_citations:
          citations.length > 0 ? citations : webResults.sources_found?.map((s) => s.url) || [],
      };
    }

    costTracker.endStage('web_search');
    return { ...silver, web_search_results: null, web_search_raw: content };
  } catch (err) {
    console.log(`⚠ xAI search failed: ${err.message}`);
    costTracker.endStage('web_search');
    return { ...silver, web_search_results: null, web_search_error: err.message };
  }
};

// === STAGE 4: GOLDEN - Analysis & Compilation ===
const extractGolden = async (silver) => {
  costTracker.startStage('golden');
  console.log('\n' + '='.repeat(60));
  console.log('STAGE 4: GOLDEN - Final Analysis & Compilation...');
  console.log('='.repeat(60));

  // Build search context from silver data + web search results
  const searchContext = {
    title: silver.merged?.title || silver.basic.title,
    brand: silver.merged?.brand || silver.basic.vendor,
    mpn: silver.merged?.mpn || silver.identity.sku,
    gtin: silver.merged?.gtin,
    category: silver.merged?.category || silver.basic.product_type,
    specifications: silver.merged?.specifications || silver.specifications,
  };

  // Add web search data if available
  const webData = silver.web_search_results;
  let webSpecsContext = '';
  if (webData) {
    webSpecsContext = `

WEB SEARCH RESULTS (from xAI Grok live search):
- Sources found: ${webData.search_summary?.total_sources || webData.sources_found?.length || 0}
- High confidence matches: ${webData.search_summary?.high_confidence_matches || 0}
- Manufacturer: ${webData.manufacturer_data?.name || 'unknown'}

Consolidated specs from web:
${JSON.stringify(webData.consolidated_specs || [], null, 2)}

Sources detail:
${JSON.stringify(webData.sources_found?.slice(0, 5) || [], null, 2)}`;
  }

  console.log('Building comprehensive product analysis...');
  console.log(`  Title: ${searchContext.title}`);
  console.log(`  Brand: ${searchContext.brand}`);
  console.log(`  MPN: ${searchContext.mpn}`);
  console.log(`  GTIN: ${searchContext.gtin || 'N/A'}`);
  if (webData) {
    console.log(`  Web sources: ${webData.sources_found?.length || 0}`);
  }

  // Use AI to analyze what additional information would be valuable
  // and generate structured search suggestions
  const researchPrompt = `You are a product research expert. Based on the product data below, 
provide additional structured information that would make this a "Golden Record" - 
a comprehensive product entry with all possible attributes.

Current product data:
${JSON.stringify(searchContext, null, 2)}

Existing specifications:
${JSON.stringify(silver.merged?.specifications || silver.specifications, null, 2)}
${webSpecsContext}

TASK: Analyze this product and provide:
1. Product classification - what type of product is this exactly
2. Standard attributes for this product category that should be filled
3. Any missing critical information
4. Suggested canonical attribute names (English, lowercase_with_underscores)
5. Quality assessment of current data
6. Merge all specifications from all sources into a unified list

Return JSON:
{
  "product_classification": {
    "primary_category": string,
    "subcategory": string,
    "product_type_standard": string (e.g., "O-Ring", "Seal", "Gasket")
  },
  "suggested_attributes": [
    {"name": string, "importance": "critical"|"important"|"nice_to_have", "current_value": any|null, "suggested_source": string}
  ],
  "unified_specifications": [
    {"name": string, "value": string, "unit": string|null, "confidence": number, "sources": string[]}
  ],
  "data_completeness": {
    "score": number 0-100,
    "missing_critical": string[],
    "missing_important": string[]
  },
  "seo_keywords": string[],
  "related_products": string[] (types of products often bought together),
  "technical_standards": string[] (relevant ISO, DIN, SAE standards if applicable),
  "golden_record_assessment": {
    "ready_for_golden": boolean,
    "blocking_issues": string[],
    "recommendations": string[]
  }
}`;

  console.log('\nAnalyzing product for Golden Record completeness...');

  const messages = [
    {
      role: 'system',
      content: `You are a product information expert specializing in industrial and agricultural parts.
You have deep knowledge of:
- O-rings, seals, gaskets (materials, standards, sizing)
- Agricultural equipment parts (Kramp, Granit, etc.)
- Technical specifications and standards (ISO, DIN, etc.)
- E-commerce product data requirements

Provide accurate, structured analysis. Do not invent specific values you don't know.
When merging specifications from multiple sources, prioritize manufacturer data.`,
    },
    {
      role: 'user',
      content: researchPrompt,
    },
  ];

  const dsResp = await aiRequest(messages, { temperature: 0.2 });
  const content = dsResp?.choices?.[0]?.message?.content || '';
  const goldenAnalysis = parseJsonResponse(content);

  if (!goldenAnalysis) {
    console.log('⚠ Failed to parse golden analysis');
    costTracker.endStage('golden');
    return {
      ...silver,
      level: 'golden',
      golden_analysis: null,
      golden_raw: content,
    };
  }

  console.log(`\n✓ Golden Analysis Complete`);
  console.log(
    `  Classification: ${goldenAnalysis.product_classification?.product_type_standard || 'N/A'}`
  );
  console.log(`  Data Completeness: ${goldenAnalysis.data_completeness?.score || 'N/A'}%`);
  console.log(
    `  Ready for Golden: ${goldenAnalysis.golden_record_assessment?.ready_for_golden ? 'Yes' : 'No'}`
  );
  console.log(`  Unified specs: ${goldenAnalysis.unified_specifications?.length || 0}`);

  if (goldenAnalysis.data_completeness?.missing_critical?.length) {
    console.log(
      `  Missing Critical: ${goldenAnalysis.data_completeness.missing_critical.join(', ')}`
    );
  }

  // Determine sources used
  const sourcesUsed = ['shopify'];
  if (silver.vendor_data) sourcesUsed.push('vendor');
  if (silver.web_search_results) sourcesUsed.push('web_search');
  sourcesUsed.push('ai_analysis');

  // Build the Golden Record
  const golden = {
    ...silver,
    level: 'golden',
    golden_analysis: goldenAnalysis,
    golden_record: {
      // Identity
      identifiers: {
        shopify_id: silver.identity.shopify_id,
        handle: silver.identity.handle,
        sku: silver.identity.sku,
        mpn: silver.merged?.mpn || webData?.manufacturer_data?.part_number,
        gtin: silver.merged?.gtin,
        barcode: silver.identity.barcode,
      },
      // Classification
      classification: {
        primary_category: goldenAnalysis.product_classification?.primary_category,
        subcategory: goldenAnalysis.product_classification?.subcategory,
        product_type: goldenAnalysis.product_classification?.product_type_standard,
        vendor: silver.basic.vendor,
        brand: silver.merged?.brand,
        manufacturer: silver.merged?.manufacturer || webData?.manufacturer_data?.name,
      },
      // Content
      content: {
        title: silver.merged?.title || silver.basic.title,
        description: silver.content.description,
        seo_keywords: goldenAnalysis.seo_keywords || [],
      },
      // Technical Specifications (normalized & unified)
      specifications:
        goldenAnalysis.unified_specifications ||
        normalizeSpecifications(
          silver.merged?.specifications || silver.specifications,
          goldenAnalysis.suggested_attributes || []
        ),
      // Dimensions
      dimensions: silver.merged?.dimensions || extractDimensionsFromSpecs(silver.specifications),
      // Materials & Applications
      materials: silver.merged?.materials || [],
      applications: silver.merged?.applications || [],
      technical_standards: goldenAnalysis.technical_standards || [],
      // Pricing
      pricing: silver.pricing,
      // Quality Metadata
      quality: {
        level: 'golden',
        completeness_score: goldenAnalysis.data_completeness?.score || 0,
        sources: sourcesUsed,
        web_sources_count: webData?.sources_found?.length || 0,
        missing_critical: goldenAnalysis.data_completeness?.missing_critical || [],
        missing_important: goldenAnalysis.data_completeness?.missing_important || [],
        last_enriched: new Date().toISOString(),
      },
      // Related
      related_products: goldenAnalysis.related_products || [],
      // Web citations (if available)
      citations: silver.web_citations || [],
    },
  };

  costTracker.endStage('golden');
  return golden;
};

// Helper: normalize specifications to canonical format
const normalizeSpecifications = (specs, suggestedAttrs) => {
  const normalized = {};

  // Convert existing specs
  if (specs && typeof specs === 'object') {
    for (const [key, data] of Object.entries(specs)) {
      const canonicalKey = key
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      normalized[canonicalKey] = {
        value: typeof data === 'object' ? data.value : data,
        unit: typeof data === 'object' ? data.unit : null,
        source: typeof data === 'object' ? data.source : 'unknown',
        confidence: 1.0,
      };
    }
  }

  // Add suggested attributes that have current values
  for (const attr of suggestedAttrs) {
    if (attr.current_value !== null && attr.current_value !== undefined) {
      const canonicalKey = attr.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      if (!normalized[canonicalKey]) {
        normalized[canonicalKey] = {
          value: attr.current_value,
          unit: null,
          source: 'ai_inferred',
          confidence: 0.8,
        };
      }
    }
  }

  return normalized;
};

// Helper: try to extract dimensions from specs
const extractDimensionsFromSpecs = (specs) => {
  if (!specs || typeof specs !== 'object') return null;

  const dimensions = {};
  const dimMapping = {
    lungime: 'length',
    latime: 'width',
    inaltime: 'height',
    greutate: 'weight',
    length: 'length',
    width: 'width',
    height: 'height',
    weight: 'weight',
  };

  for (const [key, value] of Object.entries(specs)) {
    const cleanKey = key.replace(/:$/, '').trim().toLowerCase();
    if (dimMapping[cleanKey]) {
      const numValue = parseFloat(String(value).replace(',', '.'));
      if (!isNaN(numValue)) {
        dimensions[dimMapping[cleanKey]] = numValue;
      }
    }
  }

  return Object.keys(dimensions).length > 0 ? dimensions : null;
};

// === MAIN PIPELINE ===
const runPipeline = async () => {
  const searchProvider = hasSerper ? 'Serper (Google)' : hasXai ? 'xAI Grok' : 'none';
  const aiProvider = hasDeepseek ? 'DeepSeek' : hasXai ? 'xAI' : 'none';

  console.log('\n' + '╔'.padEnd(60, '═') + '╗');
  console.log('║' + ' GOLDEN RECORD PIPELINE '.padStart(42).padEnd(58) + '║');
  console.log('║' + ` Product: ${HANDLE}`.padEnd(58) + '║');
  console.log('║' + ` AI: ${aiProvider} | Search: ${searchProvider}`.padEnd(58) + '║');
  console.log('╚'.padEnd(60, '═') + '╝');

  const startTime = Date.now();

  // Stage 1: Bronze
  const bronze = await extractBronze(HANDLE);

  // Stage 2: Silver
  const silver = await extractSilver(bronze);

  // Stage 3: Web Search (requires xAI)
  const silverWithWeb = await webSearchProducts(silver);

  // Stage 4: Golden
  const golden = await extractGolden(silverWithWeb);

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  // Save output
  const outDir = path.resolve(__dirname);
  const outPath = path.join(outDir, `golden-record-${HANDLE}.json`);
  fs.writeFileSync(outPath, JSON.stringify(golden, null, 2), 'utf-8');

  console.log('\n' + '='.repeat(60));
  console.log('PIPELINE COMPLETE');
  console.log('='.repeat(60));
  console.log(`Duration: ${duration}s`);
  console.log(`Output: ${outPath}`);
  console.log(`Final Level: ${golden.level}`);
  console.log(`Completeness: ${golden.golden_analysis?.data_completeness?.score || 'N/A'}%`);
  console.log(`Sources used: ${golden.golden_record?.quality?.sources?.join(', ') || 'N/A'}`);
  if (golden.golden_record?.quality?.web_sources_count) {
    console.log(`Web sources: ${golden.golden_record.quality.web_sources_count}`);
  }

  // Print summary
  console.log('\n--- GOLDEN RECORD SUMMARY ---');
  console.log(JSON.stringify(golden.golden_record, null, 2));

  // === COST TRACKING REPORT ===
  console.log('\n');
  costTracker.printReport();

  // Save cost data alongside golden record
  const costReport = costTracker.generateReport();
  const costPath = path.join(outDir, `golden-record-${HANDLE}-costs.json`);
  fs.writeFileSync(costPath, JSON.stringify(costReport, null, 2), 'utf-8');
  console.log(`\n💾 Cost report saved: ${costPath}`);

  return golden;
};

// Run
runPipeline().catch((err) => {
  console.error('\n❌ Pipeline failed:', err?.message || err);
  costTracker.printReport(); // Print cost even on error
  process.exit(1);
});
