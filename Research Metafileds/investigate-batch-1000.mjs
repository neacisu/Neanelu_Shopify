import fs from 'fs';
import path from 'path';
import https from 'https';
import readline from 'readline';

const SAMPLE_SIZE = 1000;
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

const productQuery = `
query ProductInvestigate($handleQuery: String!) {
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
}
`;

const definitionsQuery = `
query ProductMetafieldDefinitions {
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

const request = (body) =>
  new Promise((resolve, reject) => {
    const options = {
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

const reservoirSample = () => {
  const fd = fs.openSync(JSONL_PATH, 'r');
  const bufferSize = 1024 * 1024;
  const buffer = Buffer.alloc(bufferSize);
  let leftover = '';
  let bytesRead = 0;
  let seen = 0;
  const sample = [];

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
          seen += 1;
          if (sample.length < SAMPLE_SIZE) {
            sample.push({ id: obj.id, handle: obj.handle, title: obj.title || '' });
          } else {
            const j = Math.floor(Math.random() * seen);
            if (j < SAMPLE_SIZE) {
              sample[j] = { id: obj.id, handle: obj.handle, title: obj.title || '' };
            }
          }
        }
      } catch {
        // ignore malformed lines
      }
    }
  }

  fs.closeSync(fd);
  return { sample, seen };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const formatProgress = (stats) => {
  const elapsedSec = Math.max(1, Math.floor((Date.now() - stats.startedAt) / 1000));
  const rate = (stats.processed / elapsedSec).toFixed(2);
  const avgRequested = stats.costRequestedCount
    ? (stats.costRequestedTotal / stats.costRequestedCount).toFixed(2)
    : '0';
  const avgActual = stats.costActualCount
    ? (stats.costActualTotal / stats.costActualCount).toFixed(2)
    : '0';
  return [
    `processed ${stats.processed}/${stats.total}`,
    `rate ${rate}/s`,
    `avgCost req=${avgRequested} act=${avgActual}`,
    `metafields=${stats.metafieldsTotal}`,
    `unstructured=${stats.unstructuredTotal}`,
    `appOwned=${stats.appOwnedCount}`,
    `shopify--=${stats.shopifyReservedCount}`,
    `custom=${stats.customCount}`,
    `sync_meta=${stats.syncMetaCount}`,
  ].join(' | ');
};

const main = async () => {
  const { sample, seen } = reservoirSample();
  if (!sample.length) {
    console.error('No products found in JSONL.');
    process.exit(1);
  }

  const defsResp = await request(JSON.stringify({ query: definitionsQuery }));
  const definitions = defsResp?.data?.metafieldDefinitions?.nodes ?? [];

  const outDir = path.resolve(process.cwd(), 'Research Metafileds');
  const outPath = path.join(outDir, 'investigation-batch-1000-report.json');

  const report = {
    sourceJsonl: JSONL_PATH,
    totalProductsInJsonl: seen,
    sampleSize: sample.length,
    testedAt: new Date().toISOString(),
    definitions,
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
      explicitMissing: {
        descriere_scurta: 0,
        unitate_de_masura: 0,
        vendor: 0,
        specificatii_produs: 0,
        wholesale_product_url: 0,
        app_eligibility: 0,
      },
    },
  };

  const stats = {
    total: sample.length,
    processed: 0,
    startedAt: Date.now(),
    metafieldsTotal: 0,
    unstructuredTotal: 0,
    appOwnedCount: 0,
    shopifyReservedCount: 0,
    customCount: 0,
    syncMetaCount: 0,
    costRequestedTotal: 0,
    costRequestedCount: 0,
    costActualTotal: 0,
    costActualCount: 0,
  };

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.pause();

  for (const item of sample) {
    let response;
    try {
      response = await request(
        JSON.stringify({ query: productQuery, variables: { handleQuery: `handle:${item.handle}` } })
      );
    } catch (err) {
      report.results.push({ handle: item.handle, id: item.id, error: err?.message || String(err) });
      stats.processed += 1;
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(formatProgress(stats));
      await sleep(500);
      continue;
    }

    const product = response?.data?.products?.nodes?.[0] ?? null;
    const cost = response?.extensions?.cost ?? null;

    if (cost?.requestedQueryCost != null) {
      stats.costRequestedTotal += cost.requestedQueryCost;
      stats.costRequestedCount += 1;
    }
    if (cost?.actualQueryCost != null) {
      stats.costActualTotal += cost.actualQueryCost;
      stats.costActualCount += 1;
    }

    if (!product) {
      report.summary.productsNotFound += 1;
      report.results.push({ handle: item.handle, id: item.id, notFound: true, cost });
      stats.processed += 1;
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(formatProgress(stats));
      await sleep(300);
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

    const explicit = {
      descriere_scurta: product.descriere_scurta || null,
      unitate_de_masura: product.unitate_de_masura || null,
      vendor: product.vendor_custom || null,
      specificatii_produs: product.specificatii_produs || null,
      wholesale_product_url: product.wholesale_product_url || null,
      app_eligibility: product.app_eligibility || null,
    };

    if (!explicit.descriere_scurta) report.summary.explicitMissing.descriere_scurta += 1;
    if (!explicit.unitate_de_masura) report.summary.explicitMissing.unitate_de_masura += 1;
    if (!explicit.vendor) report.summary.explicitMissing.vendor += 1;
    if (!explicit.specificatii_produs) report.summary.explicitMissing.specificatii_produs += 1;
    if (!explicit.wholesale_product_url) report.summary.explicitMissing.wholesale_product_url += 1;
    if (!explicit.app_eligibility) report.summary.explicitMissing.app_eligibility += 1;

    report.results.push({
      handle: product.handle,
      id: product.id,
      status: product.status,
      metafieldsCount: metafields.length,
      unstructuredCount: unstructured.length,
      namespaces,
      hasAppOwned,
      hasShopifyReserved,
      hasCustom,
      hasSyncMeta,
      explicit,
      cost,
    });

    stats.processed += 1;
    stats.metafieldsTotal += metafields.length;
    stats.unstructuredTotal += unstructured.length;
    if (hasAppOwned) stats.appOwnedCount += 1;
    if (hasShopifyReserved) stats.shopifyReservedCount += 1;
    if (hasCustom) stats.customCount += 1;
    if (hasSyncMeta) stats.syncMetaCount += 1;

    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(formatProgress(stats));

    const available = cost?.throttleStatus?.currentlyAvailable ?? 9999;
    const restoreRate = cost?.throttleStatus?.restoreRate ?? 50;
    if (available < 200) {
      await sleep(1200);
    } else if (available < 500) {
      await sleep(600);
    } else {
      await sleep(Math.max(120, Math.floor(1000 / restoreRate)));
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  console.log(formatProgress(stats));
  console.log(`\nReport saved: ${outPath}`);
  rl.close();
};

main().catch((err) => {
  console.error('Batch investigation failed:', err?.message || err);
  process.exit(1);
});
