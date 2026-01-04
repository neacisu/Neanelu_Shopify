#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  gqlPost,
  loadEnvFile,
  makeRng,
  parseCli,
  PythonRandom,
  shuffleInPlace,
  sleep,
  writeJsonFile,
} from './common.js';

type AnyObj = Record<string, any>;

type VendorSampleReport = {
  seed?: number | null;
  k: number;
  vendorCount: number;
  vendors: Array<{
    vendor: string;
    productCountInFile: number;
    sampled: Array<{ productId: string; productLine: number }>;
  }>;
};

const PRODUCT_FIELDS_INTROSPECTION = `
query ProductFields {
  __type(name: "Product") {
    name
    fields {
      name
      args {
        name
        defaultValue
        type {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                }
              }
            }
          }
        }
      }
      type {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
        }
      }
    }
  }
}
`;

const INTROSPECT_TYPE_QUERY = `
query IntrospectType($name: String!) {
  __type(name: $name) {
    kind
    name
    fields {
      name
      args {
        name
        defaultValue
        type {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                }
              }
            }
          }
        }
      }
      type {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
        }
      }
    }
  }
}
`;

// Curated product details query (stable, low risk). Used when --everything is not enabled.
const PRODUCT_DETAILS_QUERY = `
query ProductDetails($id: ID!) {
  product(id: $id) {
    id
    legacyResourceId
    title
    handle
    vendor
    status
    createdAt
    updatedAt
    description
    descriptionHtml
    tags

    seo { title description }

    featuredImage { id url altText width height }

    options { id name values }

    priceRangeV2 {
      minVariantPrice { amount currencyCode }
      maxVariantPrice { amount currencyCode }
    }

    variants(first: 100) {
      nodes {
        id
        legacyResourceId
        title
        sku
        barcode
        price
        compareAtPrice
        taxable
        inventoryQuantity
        availableForSale
        inventoryPolicy
        requiresComponents
        unitPrice { amount currencyCode }
        unitPriceMeasurement {
          measuredType
          quantityUnit
          quantityValue
          referenceUnit
          referenceValue
        }
        selectedOptions { name value }
        image { id url altText width height }
        inventoryItem {
          id
          tracked
          unitCost { amount currencyCode }
        }
      }
      pageInfo { hasNextPage endCursor }
    }

    metafields(first: 250) {
      nodes {
        id
        namespace
        key
        type
        value
        jsonValue
        createdAt
        updatedAt
        description
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
`;

const PRODUCT_METAFIELDS_PAGE_QUERY = `
query ProductMetafieldsPage($id: ID!, $after: String) {
  product(id: $id) {
    metafields(first: 250, after: $after) {
      nodes {
        id
        namespace
        key
        type
        value
        jsonValue
        createdAt
        updatedAt
        description
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
`;

const PRODUCT_VARIANTS_PAGE_QUERY = `
query ProductVariantsPage($id: ID!, $after: String) {
  product(id: $id) {
    variants(first: 100, after: $after) {
      nodes {
        id
        legacyResourceId
        title
        sku
        barcode
        price
        compareAtPrice
        taxable
        inventoryQuantity
        availableForSale
        inventoryPolicy
        requiresComponents
        unitPrice { amount currencyCode }
        unitPriceMeasurement {
          measuredType
          quantityUnit
          quantityValue
          referenceUnit
          referenceValue
        }
        selectedOptions { name value }
        image { id url altText width height }
        inventoryItem {
          id
          tracked
          unitCost { amount currencyCode }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
`;

type TypeRef = { kind: string; name: string | null; ofType?: TypeRef | null };

function unwrapType(t: TypeRef): { baseKind: string; baseName: string | null; isList: boolean } {
  let isList = false;
  let cur: TypeRef | null | undefined = t;
  while (cur && (cur.kind === 'NON_NULL' || cur.kind === 'LIST')) {
    if (cur.kind === 'LIST') isList = true;
    cur = cur.ofType ?? null;
  }
  return { baseKind: cur?.kind ?? '', baseName: cur?.name ?? null, isList };
}

function hasRequiredArgs(args: Array<{ type: TypeRef; defaultValue: any }>): boolean {
  for (const a of args ?? []) {
    const kind = a?.type?.kind;
    if (kind === 'NON_NULL' && a.defaultValue === null) return true;
  }
  return false;
}

function isConnectionTypeName(typeName: string | null): boolean {
  return !!typeName && typeName.endsWith('Connection');
}

function safeFieldName(name: string): boolean {
  return !!name && !name.startsWith('__');
}

function pickObjectScalarFields(typeInfo: AnyObj, maxFields: number): AnyObj[] {
  const fields: AnyObj[] = typeInfo?.fields ?? [];
  const picked: AnyObj[] = [];

  for (const f of fields) {
    if (f?.name === 'id') {
      picked.push(f);
      break;
    }
  }

  for (const f of fields) {
    const n = f?.name;
    if (!safeFieldName(n)) continue;
    if (n === 'id') continue;
    const { baseKind } = unwrapType(f?.type ?? { kind: '', name: null });
    if ((baseKind === 'SCALAR' || baseKind === 'ENUM') && !(f?.args?.length ?? 0)) {
      picked.push(f);
    }
    if (picked.length >= maxFields) break;
  }

  return picked;
}

async function buildEverythingProductQuery(opts: {
  endpoint: string;
  token: string;
  maxDepth: number;
  connectionFirst: number;
  connectionMaxFields: number;
  skipFields: string[];
}): Promise<{ query: string; meta: AnyObj }>
{
  const cache = new Map<string, AnyObj>();
  const skipped: Array<{ field: string; reason: string }> = [];
  const skipSet = new Set<string>(['publishedOnCurrentPublication', ...opts.skipFields.map((s) => s.trim()).filter(Boolean)]);

  async function getType(typeName: string): Promise<AnyObj> {
    const cached = cache.get(typeName);
    if (cached) return cached;
    const resp = await gqlPost<{ __type: AnyObj }>(opts.endpoint, opts.token, INTROSPECT_TYPE_QUERY, { name: typeName }, 60_000);
    const t = (resp.data as any)?.__type ?? {};
    cache.set(typeName, t);
    return t;
  }

  async function buildSelectionForType(typeName: string, depth: number, visited: string[]): Promise<string> {
    // Match Python formatting: base-case is a single line.
    if (depth > opts.maxDepth) return 'id __typename';
    if (visited.includes(typeName)) return 'id __typename';

    const t = await getType(typeName);
    if (!t?.name) return '__typename';

    if (typeName === 'MoneyV2') return 'amount currencyCode';
    if (typeName === 'SEO') return 'title description';
    if (typeName === 'Image' || typeName === 'ImageSource') return 'id url altText width height';

    const picked = pickObjectScalarFields(t, opts.connectionMaxFields);
    const out: string[] = ['__typename'];
    for (const f of picked) {
      const n = f?.name;
      if (!n) continue;
      if (skipSet.has(n)) continue;
      if (!out.includes(n)) out.push(n);
    }
    return out.join('\n');
  }

  const productType = await getType('Product');
  const productFields: AnyObj[] = productType?.fields ?? [];

  const selectionLines: string[] = ['id', '__typename'];

  for (const f of productFields) {
    const fname: string = f?.name;
    if (!safeFieldName(fname)) continue;

    if (skipSet.has(fname)) {
      skipped.push({ field: fname, reason: 'skip_list' });
      continue;
    }

    const args: AnyObj[] = f?.args ?? [];
    if (hasRequiredArgs(args as any)) {
      skipped.push({ field: fname, reason: 'requires_args' });
      continue;
    }

    const { baseKind, baseName } = unwrapType((f?.type ?? { kind: '', name: null }) as any);

    if (baseKind === 'SCALAR' || baseKind === 'ENUM') {
      selectionLines.push(fname);
      continue;
    }

    if (baseKind === 'OBJECT' && isConnectionTypeName(baseName)) {
      const connType = baseName ? await getType(baseName) : {};
      let nodeTypeName: string | null = null;
      for (const cf of connType?.fields ?? []) {
        if (cf?.name === 'nodes') {
          const u = unwrapType((cf?.type ?? { kind: '', name: null }) as any);
          nodeTypeName = u.baseName;
          break;
        }
      }

      // Match Python: include (first: N) only if the field supports `first`.
      const argNames = new Set<string>((args ?? []).map((a) => String(a?.name ?? '')));
      const argStr = argNames.has('first') ? `(first: ${opts.connectionFirst})` : '';

      // Match Python: default node selection is minimal.
      let nodeSelection = 'id __typename';
      if (nodeTypeName) {
        const nt = await getType(nodeTypeName);
        const ntKind = String(nt?.kind ?? '');
        if (ntKind === 'OBJECT') {
          nodeSelection = await buildSelectionForType(nodeTypeName, 1, ['Product']);
        }
      }

      // Match Python indentation strategy.
      const nodeIndented = nodeSelection.split('\n').join('\n    ');
      selectionLines.push(
        `${fname}${argStr} {\n  nodes {\n    ${nodeIndented}\n  }\n  pageInfo { hasNextPage endCursor }\n}`,
      );
      continue;
    }

    if (baseKind === 'OBJECT' && baseName) {
      // Nested object: include some scalar fields.
      const sub = await buildSelectionForType(baseName, 1, ['Product']);
      const subIndented = sub.split('\n').join('\n  ');
      selectionLines.push(`${fname} {\n  ${subIndented}\n}`);
      continue;
    }

    if (baseKind === 'INTERFACE' || baseKind === 'UNION') {
      // Match Python behavior: include only __typename for interface/union fields.
      // This avoids needing inline fragments while still surfacing the field.
      selectionLines.push(`${fname} { __typename }`);
      continue;
    }

    // Anything else is skipped (best-effort / avoid costly fragments)
    skipped.push({ field: fname, reason: `unsupported_kind_${baseKind}` });
  }

  // Match Python query assembly / indentation.
  const query =
    'query ProductEverything($id: ID!) {\n' +
    '  product(id: $id) {\n' +
    '    ' +
    selectionLines.join('\n    ') +
    '\n' +
    '  }\n' +
    '}';

  return {
    query,
    meta: {
      skipped,
      // Match Python naming for easier diffs.
      introspectedTypes: Array.from(cache.keys()).sort(),
    },
  };
}

function indent(s: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return s
    .split('\n')
    .map((line) => (line.trim().length ? pad + line : line))
    .join('\n');
}

function pickTestSet(
  report: VendorSampleReport,
  vendorCount: number,
  seed: number,
  pickMode: 'random' | 'report-order',
): VendorSampleReport['vendors'] {
  const vendors = [...report.vendors];
  const eligible = vendors.filter((v) => (v.sampled ?? []).length > 0);
  const n = Math.min(vendorCount, eligible.length);

  let chosen: VendorSampleReport['vendors'];
  if (pickMode === 'report-order') {
    chosen = eligible.slice(0, n);
  } else {
    const py = new PythonRandom(seed);
    py.shuffleInPlace(eligible);
    chosen = eligible.slice(0, n);
  }

  // Match Python: sort by vendor name for stable diff.
  chosen.sort((a, b) => {
    const av = String(a.vendor ?? '');
    const bv = String(b.vendor ?? '');
    return av < bv ? -1 : av > bv ? 1 : 0;
  });
  return chosen;
}

async function paginateMetafields(endpoint: string, token: string, productId: string, baseResp: AnyObj): Promise<void> {
  const product = (baseResp?.data ?? {})?.product;
  if (!product || typeof product !== 'object') return;

  const mf = product.metafields ?? {};
  const nodes: any[] = Array.isArray(mf.nodes) ? [...mf.nodes] : [];
  const pageInfo = mf.pageInfo ?? {};
  let hasNext = !!pageInfo.hasNextPage;
  let cursor = pageInfo.endCursor as string | null | undefined;

  let pages = 1;
  while (hasNext && cursor && pages < 200) {
    const page = await gqlPost<any>(endpoint, token, PRODUCT_METAFIELDS_PAGE_QUERY, { id: productId, after: cursor }, 90_000);
    if (page.errors?.length) {
      baseResp.extensions = baseResp.extensions ?? {};
      baseResp.extensions.metafieldsPaginationErrors = page.errors;
      break;
    }

    const p2 = (page.data ?? {})?.product ?? {};
    const mf2 = p2.metafields ?? {};
    const nodes2 = Array.isArray(mf2.nodes) ? mf2.nodes : [];
    nodes.push(...nodes2);

    const pi2 = mf2.pageInfo ?? {};
    hasNext = !!pi2.hasNextPage;
    cursor = pi2.endCursor;

    pages += 1;
    await sleep(20);
  }

  product.metafields = {
    nodes,
    pageInfo: { hasNextPage: false, endCursor: cursor ?? null },
  };
  product.metafieldsCountFetched = nodes.length;
}

function recordBaseVariantsCount(baseResp: AnyObj): void {
  const product = (baseResp?.data ?? {})?.product;
  if (!product || typeof product !== 'object') return;
  const v = product.variants ?? {};
  const nodes = Array.isArray(v.nodes) ? v.nodes : [];
  if (product.variantsCountFetched === undefined) product.variantsCountFetched = nodes.length;
}

async function paginateVariantsIfRequested(
  endpoint: string,
  token: string,
  productId: string,
  baseResp: AnyObj,
  opts: { enabled: boolean; maxPages: number; sleepMs: number },
): Promise<void> {
  if (!opts.enabled) return;

  const product = (baseResp?.data ?? {})?.product;
  if (!product || typeof product !== 'object') return;

  const variants = product.variants ?? {};
  const nodes: any[] = Array.isArray(variants.nodes) ? [...variants.nodes] : [];
  const pi = variants.pageInfo ?? {};
  let hasNext = !!pi.hasNextPage;
  let cursor = pi.endCursor as string | null | undefined;

  let pages = 1;
  while (hasNext && cursor && pages < opts.maxPages) {
    const page = await gqlPost<any>(endpoint, token, PRODUCT_VARIANTS_PAGE_QUERY, { id: productId, after: cursor }, 120_000);
    if (page.errors?.length) {
      baseResp.extensions = baseResp.extensions ?? {};
      baseResp.extensions.variantsPaginationErrors = page.errors;
      break;
    }

    const p2 = (page.data ?? {})?.product ?? {};
    const v2 = p2.variants ?? {};
    const nodes2 = Array.isArray(v2.nodes) ? v2.nodes : [];
    nodes.push(...nodes2);

    const pi2 = v2.pageInfo ?? {};
    hasNext = !!pi2.hasNextPage;
    cursor = pi2.endCursor;

    pages += 1;
    await sleep(opts.sleepMs);
  }

  product.variants = {
    nodes,
    pageInfo: { hasNextPage: false, endCursor: cursor ?? null },
  };
  product.variantsCountFetched = nodes.length;
}

async function main(): Promise<number> {
  const cli = parseCli(process.argv.slice(2));
  if (cli.flags.has('help')) {
    console.log(
      [
        'Usage: fetch_shopify_products.ts [--env ../../.env] [--report Research Produse/Outputs/vendor_samples_report.json] [--api-version 2025-10]',
        '       [--vendor-count 10] [--seed 42] [--out-details Research Produse/Outputs/products_TOT_10x3.json]',
        '       [--everything] [--everything-max-depth 2] [--everything-connection-first 50] [--everything-connection-max-fields 25]',
        '       [--everything-skip-fields publishedOnCurrentPublication] [--out-everything-query path] [--everything-query-file path]',
        '       [--paginate-variants] [--paginate-variants-max-pages 10] [--paginate-variants-sleep 0.02]',
        '',
        'Fetch Shopify product details for N test vendors x 3 products each via Admin GraphQL.',
      ].join('\n'),
    );
    return 0;
  }

  const envPath = String(cli.values.env ?? '../../.env');
  const reportPath = String(cli.values.report ?? 'Research Produse/TSOutputs/vendor_samples_report.json');
  const apiVersion = String(cli.values['api-version'] ?? '2025-10');
  const vendorCount = Number(cli.values['vendor-count'] ?? '10');
  const seed = Number(cli.values.seed ?? '42');
  const vendorPickModeRaw = String(cli.values['vendor-pick-mode'] ?? 'random');
  const vendorPickMode = (vendorPickModeRaw === 'report-order' ? 'report-order' : 'random') as 'random' | 'report-order';
  const outDetailsPath = String(cli.values['out-details'] ?? 'Research Produse/TSOutputs/products_TOT_10x3.json');
  const outSchemaPath = String(cli.values['out-schema'] ?? 'Research Produse/TSOutputs/product_type_fields.json');
  const outEverythingQueryPath = String(cli.values['out-everything-query'] ?? '').trim();
  const everythingQueryFilePath = String(cli.values['everything-query-file'] ?? '').trim();
  const everythingEnabled = cli.flags.has('everything');
  const everythingMaxDepth = Number(cli.values['everything-max-depth'] ?? '2');
  const everythingConnFirst = Number(cli.values['everything-connection-first'] ?? '50');
  const everythingConnMaxFields = Number(cli.values['everything-connection-max-fields'] ?? '25');
  const everythingSkipFields = String(cli.values['everything-skip-fields'] ?? '');

  const paginateVariants = cli.flags.has('paginate-variants');
  const paginateVariantsMaxPages = Number(cli.values['paginate-variants-max-pages'] ?? '10');
  const paginateVariantsSleepSec = Number(cli.values['paginate-variants-sleep'] ?? '0.02');

  const env = loadEnvFile(envPath);
  const shop = env.SHOPIFY_SHOP_DOMAIN;
  const token = env.SHOPIFY_ADMIN_API_TOKEN;
  if (!shop || !token) throw new Error('Missing SHOPIFY_SHOP_DOMAIN or SHOPIFY_ADMIN_API_TOKEN in env file');

  const endpoint = `https://${shop}/admin/api/${apiVersion}/graphql.json`;

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as VendorSampleReport;
  const picked = pickTestSet(report, vendorCount, seed, vendorPickMode);

  // Introspection: list all Product fields (written for visibility/debug)
  const schemaResp = await gqlPost<any>(endpoint, token, PRODUCT_FIELDS_INTROSPECTION, null, 60_000);
  if (schemaResp.errors?.length) throw new Error(`Introspection errors: ${JSON.stringify(schemaResp.errors)}`);

  if (outSchemaPath !== '/dev/null') {
    writeJsonFile(outSchemaPath, schemaResp.data ?? {});
  }

  // Build dynamic query for --everything mode
  let everythingQuery: string | null = null;
  let everythingMeta: AnyObj = {};

  if (everythingEnabled) {
    if (everythingQueryFilePath) {
      everythingQuery = fs.readFileSync(everythingQueryFilePath, 'utf-8');
      everythingMeta = { source: 'file', path: everythingQueryFilePath };
    } else {
      const skipFields = everythingSkipFields
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const built = await buildEverythingProductQuery({
        endpoint,
        token,
        maxDepth: everythingMaxDepth,
        connectionFirst: everythingConnFirst,
        connectionMaxFields: everythingConnMaxFields,
        skipFields,
      });

      everythingQuery = built.query;
      everythingMeta = built.meta;
    }

    if (outEverythingQueryPath) {
      fs.mkdirSync(path.dirname(outEverythingQueryPath) || '.', { recursive: true });
      fs.writeFileSync(outEverythingQueryPath, everythingQuery, 'utf-8');
    }
  }

  const out: AnyObj = {
    shop,
    apiVersion,
    seed,
    vendorCount: picked.length,
    everything: everythingEnabled
      ? {
          enabled: true,
          maxDepth: everythingMaxDepth,
          connectionFirst: everythingConnFirst,
          connectionMaxFields: everythingConnMaxFields,
          skipFields: everythingSkipFields
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          meta: everythingMeta,
        }
      : { enabled: false },
    vendors: [] as AnyObj[],
  };

  let totalProducts = 0;

  for (const v of picked) {
    const vendorEntry: AnyObj = {
      vendor: v.vendor,
      products: [] as AnyObj[],
    };

    for (const s of v.sampled) {
      const pid = s.productId;
      const queryToUse = everythingEnabled && everythingQuery ? everythingQuery : PRODUCT_DETAILS_QUERY;

      const resp = await gqlPost<any>(endpoint, token, queryToUse, { id: pid }, 120_000);

      // Metafields: paginate to fetch ALL accessible metafields
      try {
        await paginateMetafields(endpoint, token, pid, resp as any);
      } catch (e: any) {
        (resp as any).extensions = (resp as any).extensions ?? {};
        (resp as any).extensions.metafieldsPaginationException = e?.message ?? String(e);
      }

      // Variants: always record base count; optionally paginate
      try {
        recordBaseVariantsCount(resp as any);
      } catch (e: any) {
        (resp as any).extensions = (resp as any).extensions ?? {};
        (resp as any).extensions.variantsCountBaseException = e?.message ?? String(e);
      }

      try {
        await paginateVariantsIfRequested(endpoint, token, pid, resp as any, {
          enabled: paginateVariants,
          maxPages: paginateVariantsMaxPages,
          sleepMs: Math.max(0, paginateVariantsSleepSec * 1000),
        });
      } catch (e: any) {
        (resp as any).extensions = (resp as any).extensions ?? {};
        (resp as any).extensions.variantsPaginationException = e?.message ?? String(e);
      }

      vendorEntry.products.push({
        productId: pid,
        productLineInJsonl: (s as any).productLine,
        graphql: resp,
      });

      totalProducts += 1;
      await sleep(50);
    }

    out.vendors.push(vendorEntry);
  }

  out.fetchedProductCount = totalProducts;
  writeJsonFile(outDetailsPath, out);

  console.log(`Picked vendors: ${picked.length}`);
  console.log(`Fetched products: ${totalProducts}`);
  console.log(`Wrote product details: ${outDetailsPath}`);

  for (const v of out.vendors) {
    const titles: string[] = [];
    for (const p of v.products ?? []) {
      const data = (p.graphql?.data ?? {}) as any;
      const prod = data?.product ?? {};
      if (prod?.title) titles.push(prod.title);
    }
    console.log(`- ${v.vendor}: ${titles.length} titles`);
  }

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    const msg = err?.stack || err?.message || String(err);
    console.error(msg);
    process.exit(1);
  });
