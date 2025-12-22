#!/usr/bin/env node
/**
 * Scrape an "unstructured" product metafield from Shopify Admin UI.
 *
 * This is an UNOFFICIAL approach (browser automation) and may break at any time.
 * It exists because app-owned metafields (namespace `app--<appId>--...`) are not readable
 * via the Admin API token of a different app.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseCli } from './common.js';

type FoundMetafield = {
  namespace: string;
  key: string;
  value: string | null;
  jsonValue: any;
  sourceUrl: string;
};

function ensureDirForFile(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!dir || dir === '.') return;
  fs.mkdirSync(dir, { recursive: true });
}

function deepFindMetafields(obj: any, namespace: string, key: string, sourceUrl: string, out: FoundMetafield[]): void {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const ns = (obj as any).namespace;
    const k = (obj as any).key;
    if (ns === namespace && k === key) {
      out.push({
        namespace,
        key,
        value: (obj as any).value ?? null,
        jsonValue: (obj as any).jsonValue,
        sourceUrl,
      });
    }
    for (const v of Object.values(obj)) deepFindMetafields(v, namespace, key, sourceUrl, out);
    return;
  }

  if (Array.isArray(obj)) {
    for (const v of obj) deepFindMetafields(v, namespace, key, sourceUrl, out);
  }
}

async function main(): Promise<number> {
  const cli = parseCli(process.argv.slice(2));
  if (cli.flags.has('help')) {
    console.log(
      [
        'Usage: scrape_admin_unstructured_metafield.ts --store-handle <handle> --product-id <legacyId> --namespace <ns> --key <key> [--storage-state path] [--headful] [--timeout-seconds 45]',
        '',
        'UNOFFICIAL: scrapes Shopify Admin UI responses via Playwright.',
      ].join('\n'),
    );
    return 0;
  }

  const storeHandle = cli.values['store-handle'];
  const productId = cli.values['product-id'];
  const namespace = cli.values['namespace'];
  const key = cli.values['key'];
  const storageStatePath = String(cli.values['storage-state'] ?? '').trim();
  const headful = cli.flags.has('headful');
  const timeoutSeconds = Number(cli.values['timeout-seconds'] ?? '45');

  if (!storeHandle || !productId || !namespace || !key) {
    console.error('Missing required args. Use -h for help.');
    return 2;
  }

  let playwright: any;
  try {
    playwright = await import('playwright');
  } catch (e) {
    console.error('Playwright is not installed. Run: pnpm add -D playwright && pnpm exec playwright install chromium');
    return 2;
  }

  const targetUrl = `https://admin.shopify.com/store/${storeHandle}/products/${productId}/metafields/unstructured`;

  const found: FoundMetafield[] = [];

  const useStorageState = storageStatePath && fs.existsSync(storageStatePath) ? storageStatePath : null;

  const browser = await playwright.chromium.launch({ headless: !headful });

  const context = await browser.newContext(useStorageState ? { storageState: useStorageState } : {});
  const page = await context.newPage();

  page.on('response', async (resp: any) => {
    try {
      const headers = await resp.allHeaders();
      const ct = String(headers['content-type'] || '');
      const url = String(resp.url());
      if (!ct.includes('application/json') && !url.includes('graphql')) return;
      const data = await resp.json();
      deepFindMetafields(data, namespace, key, url, found);
    } catch {
      // ignore
    }
  });

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  if (!useStorageState) {
    if (!headful) {
      console.error('No storage state provided/found. Re-run with --headful once and save --storage-state.');
      await browser.close();
      return 2;
    }

    process.stdout.write('Login in the opened browser window. Press Enter here when the metafields page is visible...\n');
    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => resolve());
    });
  }

  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline && found.length === 0) {
    await page.waitForTimeout(500);
  }

  if (storageStatePath && !useStorageState) {
    try {
      ensureDirForFile(storageStatePath);
      await context.storageState({ path: storageStatePath });
      console.log(`Saved storage state to: ${storageStatePath}`);
    } catch (e: any) {
      console.error(`Warning: failed to save storage state: ${e?.message ?? String(e)}`);
    }
  }

  await browser.close();

  // Deduplicate
  const unique = new Map<string, FoundMetafield>();
  for (const item of found) {
    const k = JSON.stringify([item.namespace, item.key, item.value, item.jsonValue]);
    unique.set(k, item);
  }

  const results = Array.from(unique.values());

  if (!results.length) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          reason: 'Metafield not found in captured Admin responses.',
          target: { url: targetUrl, namespace, key },
        },
        null,
        2,
      ),
    );
    return 1;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        target: { url: targetUrl, namespace, key },
        matches: results.map((r) => ({
          namespace: r.namespace,
          key: r.key,
          value: r.value,
          jsonValue: r.jsonValue,
          sourceUrl: r.sourceUrl,
        })),
      },
      null,
      2,
    ),
  );

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    const msg = err?.stack || err?.message || String(err);
    console.error(msg);
    process.exit(1);
  });
