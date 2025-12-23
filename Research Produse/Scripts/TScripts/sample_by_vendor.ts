#!/usr/bin/env node
import fs from 'node:fs';
import readline from 'node:readline';
import { makeRng, parseCli, PythonRandom, writeJsonFile } from './common.js';

type JsonObject = Record<string, any>;

type ReservoirItem = {
  id: string;
  product: JsonObject;
  line: number;
};

type Reservoir = {
  seen: number;
  items: ReservoirItem[];
};

function vendorBucket(vendor: string): string {
  const v = (vendor ?? '').trim();
  if (!v) return '#';
  const ch = v[0]!.toUpperCase();
  if (ch >= 'A' && ch <= 'Z') return ch;
  return '#';
}

function pickVendorsAlphabetFirst(vendorsSorted: string[], alphabet: string): string[] {
  const byBucket = new Map<string, string[]>();
  for (const v of vendorsSorted) {
    const b = vendorBucket(v);
    const list = byBucket.get(b) ?? [];
    list.push(v);
    byBucket.set(b, list);
  }
  const picked: string[] = [];
  for (const bucket of alphabet) {
    const list = byBucket.get(bucket);
    if (list && list.length) picked.push(list[0]!);
  }
  return picked;
}

function normalizeVendor(vendor: unknown): string {
  if (vendor === null || vendor === undefined) return '(null)';
  if (typeof vendor === 'string') {
    const v = vendor.trim();
    return v ? v : '(empty)';
  }
  return String(vendor);
}

function isVariant(obj: JsonObject): boolean {
  return Object.prototype.hasOwnProperty.call(obj, '__parentId');
}

function isProduct(obj: JsonObject): boolean {
  return !isVariant(obj) && typeof obj.id === 'string' && Object.prototype.hasOwnProperty.call(obj, 'vendor');
}

function reservoirUpdate(res: Reservoir, item: ReservoirItem, k: number, randrange: (stop: number) => number): void {
  res.seen += 1;
  if (res.items.length < k) {
    res.items.push(item);
    return;
  }
  const j = randrange(res.seen);
  if (j < k) res.items[j] = item;
}

async function* iterJsonl(filePath: string): AsyncGenerator<{ lineNo: number; obj: any }> {
  const rs = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: rs, crlfDelay: Infinity });
  let lineNo = 0;
  for await (const lineRaw of rl) {
    lineNo += 1;
    const line = String(lineRaw).trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      yield { lineNo, obj };
    } catch (e: any) {
      throw new Error(`Invalid JSON on line ${lineNo}: ${e?.message ?? String(e)}`);
    }
  }
}

async function main(): Promise<number> {
  const cli = parseCli(process.argv.slice(2));
  if (cli.flags.has('help') || cli.positional.length < 1) {
    console.log(
      [
        'Usage: sample_by_vendor.ts <bulk-products.jsonl> [--k 3] [--seed 42] [--out Research Produse/TSOutputs/vendor_samples_report.json] [--alphabet-pick] [--alphabet ABCDEFGHIJKLMNOPQRSTUVWXYZ#]',
        '',
        'Count unique vendors in a Shopify bulk JSONL and sample K random products per vendor (with their variants).',
      ].join('\n'),
    );
    return cli.flags.has('help') ? 0 : 2;
  }

  const jsonlPath = String(cli.positional[0]);
  const k = Number(cli.values.k ?? '3');
  if (!Number.isFinite(k) || k <= 0) throw new Error('--k must be >= 1');

  const seed = cli.values.seed !== undefined ? Number(cli.values.seed) : undefined;
  const py = seed === undefined ? null : new PythonRandom(seed);
  const randrange = (stop: number) => {
    if (py) return py.randrange(stop);
    return Math.floor(Math.random() * stop);
  };
  const outPath = String(cli.values.out ?? 'Research Produse/TSOutputs/vendor_samples_report.json');

  const alphabetPick = cli.flags.has('alphabet-pick');
  const alphabet = String(cli.values.alphabet ?? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#');

  const vendorProductCounts = new Map<string, number>();

  // Pass 1: count vendors
  for await (const { obj } of iterJsonl(jsonlPath)) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
    const o = obj as JsonObject;
    if (!isProduct(o)) continue;
    const vendor = normalizeVendor(o.vendor);
    vendorProductCounts.set(vendor, (vendorProductCounts.get(vendor) ?? 0) + 1);
  }

  const vendorsAll = Array.from(vendorProductCounts.keys()).sort();
  const selectedVendors = alphabetPick ? pickVendorsAlphabetFirst(vendorsAll, alphabet) : vendorsAll;
  const selectedVendorSet = new Set<string>(selectedVendors);

  // Pass 2: pick products per vendor (reservoir or deterministic first-K)
  const reservoirs = new Map<string, Reservoir>();
  const sampledByVendor = new Map<string, ReservoirItem[]>();
  const selectedProductIds = new Set<string>();

  for await (const { lineNo, obj } of iterJsonl(jsonlPath)) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
    const o = obj as JsonObject;
    if (!isProduct(o)) continue;

    const vendor = normalizeVendor(o.vendor);
    if (alphabetPick && !selectedVendorSet.has(vendor)) continue;

    const pid = String(o.id);
    if (!pid) continue;

    if (alphabetPick) {
      const list = sampledByVendor.get(vendor) ?? [];
      if (list.length >= k) continue;
      list.push({ id: pid, product: o, line: lineNo });
      sampledByVendor.set(vendor, list);
      selectedProductIds.add(pid);
    } else {
      if (!reservoirs.has(vendor)) reservoirs.set(vendor, { seen: 0, items: [] });
      reservoirUpdate(reservoirs.get(vendor)!, { id: pid, product: o, line: lineNo }, k, randrange);
    }
  }

  if (!alphabetPick) {
    for (const vendor of vendorsAll) {
      const res = reservoirs.get(vendor);
      if (!res) continue;
      for (const item of res.items) if (item.id) selectedProductIds.add(item.id);
    }
  }

  // Pass 3: collect full product + variants for selected products
  const productsById = new Map<string, JsonObject>();
  const variantsByParent = new Map<string, JsonObject[]>();

  for await (const { obj } of iterJsonl(jsonlPath)) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
    const o = obj as JsonObject;

    if (isVariant(o)) {
      const parent = o.__parentId;
      if (typeof parent === 'string' && selectedProductIds.has(parent)) {
        const list = variantsByParent.get(parent) ?? [];
        list.push(o);
        variantsByParent.set(parent, list);
      }
      continue;
    }

    if (isProduct(o)) {
      const pid = String(o.id);
      if (selectedProductIds.has(pid)) productsById.set(pid, o);
    }
  }

  const report: any = {
    source: jsonlPath,
    seed,
    k,
    vendorCount: vendorsAll.length,
    mode: alphabetPick ? 'alphabet_pick' : 'reservoir',
    alphabet: alphabetPick ? alphabet : null,
    selectedVendorCount: selectedVendors.length,
    vendors: [] as any[],
  };

  const vendorsToEmit = selectedVendors;
  for (const vendor of vendorsToEmit) {
    const sampled = alphabetPick ? (sampledByVendor.get(vendor) ?? []) : (reservoirs.get(vendor)?.items ?? []);
    const vendorEntry: any = {
      vendor,
      productCountInFile: vendorProductCounts.get(vendor) ?? 0,
      sampled: [] as any[],
    };

    for (const item of sampled) {
      const pid = item.id;
      vendorEntry.sampled.push({
        productId: pid,
        productLine: item.line,
        product: productsById.get(pid) ?? null,
        variants: variantsByParent.get(pid) ?? [],
      });
    }

    report.vendors.push(vendorEntry);
  }

  writeJsonFile(outPath, report);

  console.log(`Vendors (unique): ${vendorsAll.length}`);
  console.log(`Report written: ${outPath}`);

  const top = Array.from(vendorProductCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  console.log('Top vendors by product count (up to 20):');
  for (const [v, cnt] of top) console.log(`  - ${v}: ${cnt}`);

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    const msg = err?.stack || err?.message || String(err);
    console.error(msg);
    process.exit(1);
  });
