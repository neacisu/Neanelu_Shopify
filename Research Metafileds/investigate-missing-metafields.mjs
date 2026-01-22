import fs from 'fs';
import path from 'path';
import https from 'https';

const HANDLE = process.argv[2];
if (!HANDLE) {
  console.error('Usage: node investigate-missing-metafields.mjs <product-handle>');
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

const token =
  env.SHOPIFY_ADMIN_ACCESS_TOKEN || env.SHOPIFY_ACCESS_TOKEN || env.SHOPIFY_ADMIN_API_TOKEN || '';

if (!shopDomain) {
  console.error(
    'Missing shop domain in .env (expected SHOPIFY_SHOP_DOMAIN/SHOPIFY_STORE_DOMAIN/SHOPIFY_MYSHOPIFY_DOMAIN).'
  );
  process.exit(1);
}

if (!token) {
  console.error(
    'Missing admin access token in .env (expected SHOPIFY_ADMIN_ACCESS_TOKEN/SHOPIFY_ACCESS_TOKEN/SHOPIFY_ADMIN_API_TOKEN).'
  );
  process.exit(1);
}

const query = `
query InvestigateProduct($handleQuery: String!) {
  products(first: 1, query: $handleQuery) {
    nodes {
      id
      title
      handle
      status
      vendor
      productType
      category { id name }
      descriere_scurta: metafield(namespace: "custom", key: "descriere_scurta") { id namespace key type value jsonValue }
      unitate_de_masura: metafield(namespace: "custom", key: "unitate_de_masura") { id namespace key type value jsonValue }
      vendor_custom: metafield(namespace: "custom", key: "vendor") { id namespace key type value jsonValue }
      specificatii_produs: metafield(namespace: "custom", key: "specificatii_produs") { id namespace key type value jsonValue }
      wholesale_product_url: metafield(namespace: "custom", key: "wholesale_product_url") { id namespace key type value jsonValue }
      app_eligibility: metafield(namespace: "app--3890849--eligibility", key: "eligibility_details") { id namespace key type value jsonValue }
      metafields(first: 250) {
        nodes {
          id
          namespace
          key
          type
          value
          jsonValue
          ownerType
          createdAt
          updatedAt
          definition { id name namespace key type { name } ownerType }
        }
      }
    }
  }
  metafieldDefinitions(first: 250, ownerType: PRODUCT) {
    nodes {
      id
      name
      namespace
      key
      type { name }
      ownerType
      access { admin storefront customerAccount }
    }
  }
}
`;

const body = JSON.stringify({
  query,
  variables: { handleQuery: `handle:${HANDLE}` },
});

const requestOptions = {
  method: 'POST',
  hostname: shopDomain,
  path: `/admin/api/${API_VERSION}/graphql.json`,
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'X-Shopify-Access-Token': token,
    'Shopify-GraphQL-Cost-Debug': '1',
  },
};

const run = () =>
  new Promise((resolve, reject) => {
    const req = https.request(requestOptions, (res) => {
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

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

try {
  const response = await run();
  const product = response?.data?.products?.nodes?.[0] ?? null;
  if (!product) {
    console.log(`Product not found for handle: ${HANDLE}`);
    process.exit(0);
  }

  const defs = response?.data?.metafieldDefinitions?.nodes ?? [];
  const targetNames = [
    'specificatii produs',
    'descriere scurta',
    'unitate de masura',
    'vendor',
    'wholesale product url',
  ];
  const matchedDefs = defs.filter((d) => targetNames.includes(normalize(d.name)));

  const report = {
    handle: HANDLE,
    product: {
      id: product.id,
      title: product.title,
      handle: product.handle,
      status: product.status,
      vendor: product.vendor,
      productType: product.productType,
      category: product.category,
    },
    explicitMetafields: {
      custom_descriere_scurta: product.descriere_scurta ?? null,
      custom_unitate_de_masura: product.unitate_de_masura ?? null,
      custom_vendor: product.vendor_custom ?? null,
      custom_specificatii_produs: product.specificatii_produs ?? null,
      custom_wholesale_product_url: product.wholesale_product_url ?? null,
      app_eligibility: product.app_eligibility ?? null,
    },
    metafieldsAll: product.metafields?.nodes ?? [],
    matchingDefinitions: matchedDefs,
    definitionsSampleSize: defs.length,
    cost: response?.extensions?.cost ?? null,
  };

  const outDir = path.resolve(process.cwd(), 'Research Metafileds');
  const outPath = path.join(outDir, `investigation-${HANDLE}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log(
    JSON.stringify(
      {
        product: report.product,
        metafieldsCount: report.metafieldsAll.length,
        explicitMetafields: report.explicitMetafields,
        matchingDefinitions: report.matchingDefinitions,
        cost: report.cost,
        outPath,
      },
      null,
      2
    )
  );
} catch (err) {
  console.error('Investigation failed:', err?.message || err);
  process.exit(1);
}
