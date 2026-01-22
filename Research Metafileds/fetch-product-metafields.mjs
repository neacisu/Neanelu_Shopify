import fs from 'fs';
import path from 'path';
import https from 'https';

const HANDLE = process.argv[2] || 'seminte-ridichi-johanna-10000-sem';
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
query ProductByHandle($query: String!) {
  products(first: 1, query: $query) {
    nodes {
      id
      title
      handle
      vendor
      productType
      status
      createdAt
      updatedAt
      onlineStoreUrl
      totalInventory
      options { name values }
      variants(first: 50) {
        nodes { id title sku price compareAtPrice inventoryQuantity }
      }
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
          definition { id name }
        }
      }
    }
  }
}
`;

const body = JSON.stringify({
  query,
  variables: { query: `handle:${HANDLE}` },
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

try {
  const response = await run();
  const cost = response?.extensions?.cost ?? null;
  const product = response?.data?.products?.nodes?.[0] ?? null;
  if (!product) {
    console.log(`Product not found for handle: ${HANDLE}`);
    process.exit(0);
  }

  const metafields = product.metafields?.nodes ?? [];
  const unstructured = metafields.filter((m) => !m.definition);

  const summary = {
    id: product.id,
    title: product.title,
    handle: product.handle,
    vendor: product.vendor,
    productType: product.productType,
    status: product.status,
    onlineStoreUrl: product.onlineStoreUrl,
    totalInventory: product.totalInventory,
    variantsCount: product.variants?.nodes?.length ?? 0,
    metafieldsCount: metafields.length,
    unstructuredMetafieldsCount: unstructured.length,
  };

  console.log('Product summary:');
  console.log(JSON.stringify(summary, null, 2));

  console.log('\nMetafields (all):');
  console.log(JSON.stringify(metafields, null, 2));

  if (unstructured.length) {
    console.log('\nUnstructured metafields (definition=null):');
    console.log(JSON.stringify(unstructured, null, 2));
  }

  if (cost) {
    console.log('\nGraphQL cost/throttle:');
    console.log(
      JSON.stringify(
        {
          requestedQueryCost: cost.requestedQueryCost,
          actualQueryCost: cost.actualQueryCost,
          throttleStatus: cost.throttleStatus,
        },
        null,
        2
      )
    );
  }

  const outDir = path.resolve(process.cwd(), 'Research Metafileds');
  const outPath = path.join(outDir, `product-${HANDLE}-metafields.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify({ summary, product, metafields, unstructured }, null, 2),
    'utf-8'
  );
  console.log(`\nSaved full output to ${outPath}`);
} catch (err) {
  console.error('Request failed:', err?.message || err);
  process.exit(1);
}
