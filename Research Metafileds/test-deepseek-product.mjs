import fs from 'fs';
import path from 'path';
import https from 'https';

const HANDLE = process.argv[2];
if (!HANDLE) {
  console.error('Usage: node test-deepseek-product.mjs <product-handle>');
  process.exit(1);
}

const API_VERSION = '2025-10';
const envPath = path.resolve(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
  console.error('Missing .env in project root.');
  process.exit(1);
}

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

if (!shopDomain || !shopToken) {
  console.error('Missing Shopify domain/token in .env.');
  process.exit(1);
}

if (!deepseekKey) {
  console.error('Missing DEEPSEEK_API_KEY in .env.');
  process.exit(1);
}

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
      metafields(first: 250) {
        nodes {
          id
          namespace
          key
          type
          value
          jsonValue
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
          if (json.errors) {
            reject(new Error(JSON.stringify(json.errors, null, 2)));
            return;
          }
          resolve(json);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

const fetchText = async (url) => {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} ${res.statusText}`);
  }
  return await res.text();
};

const deepseekRequest = async (payload) => {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${deepseekKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek API error (${res.status}): ${text}`);
  }
  return await res.json();
};

const toAbsoluteUrl = (url, baseUrl) => {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (!baseUrl) return url;
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
};

const extractMetafield = (metafields, namespace, key) =>
  metafields.find((m) => m.namespace === namespace && m.key === key) || null;

const main = async () => {
  console.log('[1/3] Fetch product from Shopify...');
  const shopifyBody = JSON.stringify({
    query: shopifyQuery,
    variables: { query: `handle:${HANDLE}` },
  });
  const shopifyResp = await requestShopify(shopifyBody);
  const product = shopifyResp?.data?.products?.nodes?.[0] ?? null;
  if (!product) {
    console.error(`Product not found for handle: ${HANDLE}`);
    process.exit(1);
  }

  const metafields = product.metafields?.nodes ?? [];
  const wholesale = extractMetafield(metafields, 'custom', 'wholesale_product_url');
  const specificatii = extractMetafield(metafields, 'custom', 'specificatii_produs');
  const descriereScurta = extractMetafield(metafields, 'custom', 'descriere_scurta');
  const unitateMasura = extractMetafield(metafields, 'custom', 'unitate_de_masura');

  const localContext = {
    id: product.id,
    title: product.title,
    handle: product.handle,
    vendor: product.vendor,
    productType: product.productType,
    status: product.status,
    tags: product.tags,
    description: product.description,
    descriptionHtml: product.descriptionHtml,
    metafields: {
      wholesale_product_url: wholesale?.value ?? null,
      specificatii_produs: specificatii?.jsonValue ?? null,
      descriere_scurta: descriereScurta?.value ?? null,
      unitate_de_masura: unitateMasura?.value ?? null,
    },
  };

  let htmlSnippet = '';
  if (wholesale?.value) {
    console.log('[2/3] Fetch wholesale product page HTML...');
    const html = await fetchText(wholesale.value);
    htmlSnippet = html.slice(0, 60000);
  }

  console.log('[3/3] Call DeepSeek for structured extraction...');

  const schemaInstruction = `Return ONLY valid JSON with this schema:
{
  "title": string | null,
  "brand": string | null,
  "mpn": string | null,
  "gtin": string | null,
  "category": string | null,
  "specifications": [{"name": string, "value": string, "unit": string | null}],
  "price": {"amount": number | null, "currency": string | null, "is_promotional": boolean | null} | null,
  "images": string[],
  "confidence": {"overall": number, "fields_uncertain": string[]}
}
Rules:
- Extract ONLY facts present in the provided context/HTML.
- If not found, set fields to null or empty.
- gtin must be 8-14 digits.
- confidence.overall in [0,1].
`;

  const payload = {
    model: 'deepseek-chat',
    messages: [
      {
        role: 'system',
        content: 'You extract structured product data. Never invent data.',
      },
      {
        role: 'user',
        content: `Local product data (Shopify):\n${JSON.stringify(localContext, null, 2)}\n\nWholesale HTML snippet:\n${htmlSnippet}\n\n${schemaInstruction}`,
      },
    ],
    temperature: 0.1,
    stream: false,
  };

  const ds = await deepseekRequest(payload);
  const content = ds?.choices?.[0]?.message?.content ?? '';

  let parsed = null;
  let raw = content;
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    raw = fenced[1].trim();
  }
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (parsed && Array.isArray(parsed.images)) {
    const baseUrl = wholesale?.value || null;
    parsed.images = parsed.images.map((img) => toAbsoluteUrl(img, baseUrl)).filter(Boolean);
  }

  const outDir = path.resolve(process.cwd(), 'Research Metafileds');
  const outPath = path.join(outDir, `deepseek-extract-${HANDLE}.json`);

  const outputContent = parsed ? JSON.stringify(parsed, null, 2) : content;
  fs.writeFileSync(outPath, outputContent, 'utf-8');
  console.log(`Saved DeepSeek output to ${outPath}`);
  console.log('Raw response:');
  console.log(outputContent);
};

main().catch((err) => {
  console.error('Test failed:', err?.message || err);
  process.exit(1);
});
