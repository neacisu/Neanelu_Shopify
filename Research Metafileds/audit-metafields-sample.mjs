import fs from 'fs';
import path from 'path';
import https from 'https';

const SAMPLE_SIZE = 50;
const API_VERSION = '2025-10';
const JSONL_PATH = path.resolve(process.cwd(), 'Research Produse', 'bulk-products.jsonl');

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

if (!fs.existsSync(JSONL_PATH)) {
  console.error(`Missing JSONL file: ${JSONL_PATH}`);
  process.exit(1);
}

const query = `
query ProductByHandle($handle: String!) {
  productByHandle(handle: $handle) {
    id
    title
    handle
    status
    metafields(first: 250) {
      nodes {
        id
        namespace
        key
        type
        value
        definition { id name }
      }
    }
  }
}
`;

const requestOptions = {
  method: 'POST',
  hostname: shopDomain,
  path: `/admin/api/${API_VERSION}/graphql.json`,
  headers: {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': token,
    'Shopify-GraphQL-Cost-Debug': '1',
  },
};

const runQuery = (handle) =>
  new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables: { handle } });
    const options = {
      ...requestOptions,
      headers: {
        ...requestOptions.headers,
        'Content-Length': Buffer.byteLength(body),
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

const parseProductsFromJsonl = () => {
  const products = new Map();
  const fd = fs.openSync(JSONL_PATH, 'r');
  const bufferSize = 1024 * 1024;
  const buffer = Buffer.alloc(bufferSize);
  let leftover = '';
  let bytesRead = 0;

  while ((bytesRead = fs.readSync(fd, buffer, 0, bufferSize, null)) > 0) {
    const chunk = leftover + buffer.toString('utf-8', 0, bytesRead);
    const lines = chunk.split('\n');
    leftover = lines.pop() || '';

    for (const line of lines) {
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        if (
          obj?.id &&
          typeof obj.id === 'string' &&
          obj.id.includes('gid://shopify/Product/') &&
          obj.handle
        ) {
          if (!products.has(obj.id)) {
            products.set(obj.id, { id: obj.id, handle: obj.handle, title: obj.title || '' });
          }
        }
      } catch {
        // ignore malformed lines
      }
    }
  }

  fs.closeSync(fd);
  return Array.from(products.values());
};

const sampleArray = (arr, n) => {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  const products = parseProductsFromJsonl();
  if (!products.length) {
    console.error('No products found in JSONL.');
    process.exit(1);
  }

  const sample = sampleArray(products, Math.min(SAMPLE_SIZE, products.length));
  const report = {
    sourceJsonl: JSONL_PATH,
    totalProductsInJsonl: products.length,
    sampleSize: sample.length,
    testedAt: new Date().toISOString(),
    results: [],
    summary: {
      productsTested: 0,
      productsNotFound: 0,
      metafieldsTotal: 0,
      unstructuredTotal: 0,
      namespaces: {},
      appOwnedCount: 0,
      shopifyReservedCount: 0,
      customCount: 0,
      syncMetaCount: 0,
    },
  };

  for (const item of sample) {
    await sleep(120);
    let response;
    try {
      response = await runQuery(item.handle);
    } catch (err) {
      report.results.push({
        handle: item.handle,
        id: item.id,
        error: err?.message || String(err),
      });
      continue;
    }

    const product = response?.data?.productByHandle ?? null;
    const cost = response?.extensions?.cost ?? null;

    if (!product) {
      report.summary.productsNotFound += 1;
      report.results.push({ handle: item.handle, id: item.id, notFound: true, cost });
      continue;
    }

    const metafields = product.metafields?.nodes ?? [];
    const unstructured = metafields.filter((m) => !m.definition);
    const namespaces = Array.from(new Set(metafields.map((m) => m.namespace)));

    const hasAppOwned = namespaces.some((n) => n === '$app' || n.startsWith('app--'));
    const hasShopifyReserved = namespaces.some((n) => n.startsWith('shopify--'));
    const hasCustom = namespaces.includes('custom');
    const hasSyncMeta = namespaces.includes('sync_meta');

    report.summary.productsTested += 1;
    report.summary.metafieldsTotal += metafields.length;
    report.summary.unstructuredTotal += unstructured.length;
    if (hasAppOwned) report.summary.appOwnedCount += 1;
    if (hasShopifyReserved) report.summary.shopifyReservedCount += 1;
    if (hasCustom) report.summary.customCount += 1;
    if (hasSyncMeta) report.summary.syncMetaCount += 1;

    for (const ns of namespaces) {
      report.summary.namespaces[ns] = (report.summary.namespaces[ns] || 0) + 1;
    }

    report.results.push({
      handle: product.handle,
      id: product.id,
      metafieldsCount: metafields.length,
      unstructuredCount: unstructured.length,
      namespaces,
      hasAppOwned,
      hasShopifyReserved,
      hasCustom,
      hasSyncMeta,
      cost,
    });
  }

  const outDir = path.resolve(process.cwd(), 'Research Metafileds');
  const outPath = path.join(outDir, 'audit-metafields-sample-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log(`Sampled ${report.summary.productsTested} products.`);
  console.log(`Not found: ${report.summary.productsNotFound}`);
  console.log(`Metafields total: ${report.summary.metafieldsTotal}`);
  console.log(`Unstructured total: ${report.summary.unstructuredTotal}`);
  console.log(`App-owned ($app) count: ${report.summary.appOwnedCount}`);
  console.log(`Shopify-reserved (shopify--) count: ${report.summary.shopifyReservedCount}`);
  console.log(`custom namespace count: ${report.summary.customCount}`);
  console.log(`sync_meta namespace count: ${report.summary.syncMetaCount}`);
  console.log(`Report saved: ${outPath}`);
};

main().catch((err) => {
  console.error('Audit failed:', err?.message || err);
  process.exit(1);
});
