/**
 * Pure (side-effect-free) functions extracted from pipeline workers.
 * This module MUST NOT import from any file that triggers side-effects at module
 * load time (e.g. loadEnv, queue creation, DB pools).  It is safe to import
 * from pipeline-utils.ts and pipeline-types.ts.
 */

import { normalizeWhitespace } from './pipeline-utils.js';

/* ──────────────────────────────────────────────────────────────────────────────
 * extract-fragments
 * ────────────────────────────────────────────────────────────────────────── */

/** O(n) removal of `<!-- ... -->` (no nested-regex ReDoS). */
function stripHtmlBlockComments(value: string): string {
  let s = value;
  for (;;) {
    const start = s.indexOf('<!--');
    if (start < 0) break;
    const end = s.indexOf('-->', start + 4);
    if (end < 0) {
      s = `${s.slice(0, start)} `;
      break;
    }
    s = `${s.slice(0, start)} ${s.slice(end + 3)}`;
  }
  return s;
}

/** O(n) removal of CDATA sections. */
function stripCdataSections(value: string): string {
  let s = value;
  for (;;) {
    const start = s.indexOf('<![CDATA[');
    if (start < 0) break;
    const end = s.indexOf(']]>', start + 9);
    if (end < 0) {
      s = `${s.slice(0, start)} `;
      break;
    }
    s = `${s.slice(0, start)} ${s.slice(end + 3)}`;
  }
  return s;
}

/** O(n) removal of `<...>` segments (avoids `<[^>]+>` backtracking / S5852). */
function stripHtmlTagsLinear(value: string): string {
  let out = '';
  let i = 0;
  while (i < value.length) {
    const lt = value.indexOf('<', i);
    if (lt < 0) {
      return out + value.slice(i);
    }
    out += value.slice(i, lt);
    const gt = value.indexOf('>', lt + 1);
    if (gt < 0) {
      out += ' ';
      i = lt + 1;
      continue;
    }
    out += ' ';
    i = gt + 1;
  }
  return out;
}

export function stripHtml(value: string): string {
  const withoutComments = stripHtmlBlockComments(value);
  const withoutCdata = stripCdataSections(withoutComments);
  return stripHtmlTagsLinear(withoutCdata);
}

/** Detectare liniară: există `<` urmat de `>` (echivalent practic cu testul vechi de tag HTML). */
export function rawTextContainsLikelyHtmlTag(value: string): boolean {
  const lt = value.indexOf('<');
  if (lt < 0) return false;
  return value.includes('>', lt + 1);
}

export function shouldPreserveHtmlField(fieldPath: string): boolean {
  return (
    fieldPath === 'description_html' ||
    fieldPath === 'body_html' ||
    fieldPath.endsWith('.description_html') ||
    fieldPath.endsWith('.body_html')
  );
}

export function canonicalizeText(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

export function tokenCount(value: string): number {
  const trimmed = normalizeWhitespace(value);
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export type FragmentInput = Readonly<{
  sourceTable: string;
  sourceRecordId: string;
  sourceGid?: string | null;
  productId?: string | null;
  variantId?: string | null;
  collectionId?: string | null;
  masterProductId?: string | null;
  fieldPath: string;
  fieldKind: string;
  rawText: string;
  vendorHint?: string | null;
  productTypeHint?: string | null;
  categoryHint?: string | null;
}>;

type FragmentRowBase = Omit<FragmentInput, 'fieldPath' | 'fieldKind' | 'rawText'>;

function appendFragmentIfString(
  fragments: FragmentInput[],
  base: FragmentRowBase,
  fieldPath: string,
  fieldKind: string,
  rawValue: unknown
): void {
  if (typeof rawValue === 'string' && rawValue.trim()) {
    fragments.push({ ...base, fieldPath, fieldKind, rawText: rawValue });
  }
}

function pushNestedMetafieldStrings(
  out: FragmentInput[],
  key: string,
  raw: Record<string, unknown>
): void {
  for (const [nestedKey, nestedValue] of Object.entries(raw)) {
    if (typeof nestedValue === 'string' && nestedValue.trim()) {
      out.push({
        sourceTable: 'shopify_products',
        sourceRecordId: '',
        fieldPath: `metafields.${key}.${nestedKey}`,
        fieldKind: 'metafield',
        rawText: nestedValue,
      });
    }
  }
}

export function normalizeMetafields(value: unknown): FragmentInput[] {
  if (!value || typeof value !== 'object') return [];
  const out: FragmentInput[] = [];

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string' && raw.trim()) {
      out.push({
        sourceTable: 'shopify_products',
        sourceRecordId: '',
        fieldPath: `metafields.${key}`,
        fieldKind: 'metafield',
        rawText: raw,
      });
      continue;
    }

    if (raw && typeof raw === 'object') {
      pushNestedMetafieldStrings(out, key, raw as Record<string, unknown>);
    }
  }

  return out;
}

type SourceTableName =
  | 'shopify_products'
  | 'shopify_variants'
  | 'shopify_collections'
  | 'prod_master';

function collectFragmentsFromShopifyProduct(
  id: string,
  row: Record<string, unknown>
): FragmentInput[] {
  const fragments: FragmentInput[] = [];
  const base: FragmentRowBase = {
    sourceTable: 'shopify_products',
    sourceRecordId: id,
    sourceGid: typeof row['shopify_gid'] === 'string' ? row['shopify_gid'] : null,
    productId: id,
    vendorHint: typeof row['vendor'] === 'string' ? row['vendor'] : null,
    productTypeHint: typeof row['product_type'] === 'string' ? row['product_type'] : null,
    categoryHint: typeof row['category_id'] === 'string' ? row['category_id'] : null,
  };

  appendFragmentIfString(fragments, base, 'title', 'title', row['title']);
  appendFragmentIfString(fragments, base, 'description', 'description', row['description']);
  appendFragmentIfString(
    fragments,
    base,
    'description_html',
    'description',
    row['description_html']
  );
  appendFragmentIfString(fragments, base, 'vendor', 'vendor', row['vendor']);
  appendFragmentIfString(fragments, base, 'product_type', 'product_type', row['product_type']);

  const tags = Array.isArray(row['tags'])
    ? row['tags'].filter((tag): tag is string => typeof tag === 'string')
    : [];
  for (const tag of tags) {
    appendFragmentIfString(fragments, base, 'tags[]', 'tag', tag);
  }

  if (row['seo'] && typeof row['seo'] === 'object') {
    const seo = row['seo'] as Record<string, unknown>;
    appendFragmentIfString(fragments, base, 'seo.title', 'seo_title', seo['title']);
    appendFragmentIfString(
      fragments,
      base,
      'seo.description',
      'seo_description',
      seo['description']
    );
  }

  const metafieldFragments = normalizeMetafields(row['metafields']).map((fragment) => ({
    ...fragment,
    ...base,
  }));
  fragments.push(...metafieldFragments);

  return fragments;
}

function collectFragmentsFromShopifyVariant(
  id: string,
  row: Record<string, unknown>
): FragmentInput[] {
  const fragments: FragmentInput[] = [];
  const base: FragmentRowBase = {
    sourceTable: 'shopify_variants',
    sourceRecordId: id,
    sourceGid: typeof row['shopify_gid'] === 'string' ? row['shopify_gid'] : null,
    productId: typeof row['product_id'] === 'string' ? row['product_id'] : null,
    variantId: id,
  };

  appendFragmentIfString(fragments, base, 'title', 'title', row['title']);
  appendFragmentIfString(fragments, base, 'sku', 'option_value', row['sku']);
  appendFragmentIfString(fragments, base, 'barcode', 'option_value', row['barcode']);

  if (Array.isArray(row['selected_options'])) {
    for (const [index, option] of row['selected_options'].entries()) {
      if (!option || typeof option !== 'object') continue;
      const optionObj = option as Record<string, unknown>;
      appendFragmentIfString(
        fragments,
        base,
        `selected_options.${index}.name`,
        'option_name',
        optionObj['name']
      );
      appendFragmentIfString(
        fragments,
        base,
        `selected_options.${index}.value`,
        'option_value',
        optionObj['value']
      );
    }
  }

  return fragments;
}

function collectFragmentsFromShopifyCollection(
  id: string,
  row: Record<string, unknown>
): FragmentInput[] {
  const fragments: FragmentInput[] = [];
  const base: FragmentRowBase = {
    sourceTable: 'shopify_collections',
    sourceRecordId: id,
    sourceGid: typeof row['shopify_gid'] === 'string' ? row['shopify_gid'] : null,
    collectionId: id,
  };

  appendFragmentIfString(fragments, base, 'title', 'title', row['title']);
  appendFragmentIfString(fragments, base, 'description', 'description', row['description']);
  appendFragmentIfString(
    fragments,
    base,
    'description_html',
    'description',
    row['description_html']
  );
  appendFragmentIfString(fragments, base, 'seo_title', 'seo_title', row['seo_title']);
  appendFragmentIfString(
    fragments,
    base,
    'seo_description',
    'seo_description',
    row['seo_description']
  );

  if (row['seo'] && typeof row['seo'] === 'object') {
    const seo = row['seo'] as Record<string, unknown>;
    appendFragmentIfString(fragments, base, 'seo.title', 'seo_title', seo['title']);
    appendFragmentIfString(
      fragments,
      base,
      'seo.description',
      'seo_description',
      seo['description']
    );
  }

  return fragments;
}

function collectFragmentsFromProdMaster(id: string, row: Record<string, unknown>): FragmentInput[] {
  const fragments: FragmentInput[] = [];
  const base: FragmentRowBase = {
    sourceTable: 'prod_master',
    sourceRecordId: id,
    masterProductId: id,
    categoryHint: typeof row['taxonomy_id'] === 'string' ? row['taxonomy_id'] : null,
  };
  appendFragmentIfString(fragments, base, 'canonical_title', 'title', row['canonical_title']);
  appendFragmentIfString(fragments, base, 'brand', 'vendor', row['brand']);
  appendFragmentIfString(fragments, base, 'manufacturer', 'vendor', row['manufacturer']);
  return fragments;
}

export function collectFragmentsFromRow(
  sourceTable: SourceTableName,
  row: Record<string, unknown>
): FragmentInput[] {
  const id = String(row['id']);
  switch (sourceTable) {
    case 'shopify_products':
      return collectFragmentsFromShopifyProduct(id, row);
    case 'shopify_variants':
      return collectFragmentsFromShopifyVariant(id, row);
    case 'shopify_collections':
      return collectFragmentsFromShopifyCollection(id, row);
    case 'prod_master':
      return collectFragmentsFromProdMaster(id, row);
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
 * ai-batches
 * ────────────────────────────────────────────────────────────────────────── */

export function lexAiProducedConfidenceCap(translationAutoApproveThreshold: number): number {
  const t = Math.max(0, Math.min(1, translationAutoApproveThreshold));
  return Math.max(0, Math.min(t - 0.01, 0.9999));
}

export function estimateTokens(text: string): number {
  let units = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0xffff) {
      units += 4;
    } else if (cp > 0x7f) {
      units += 3;
    } else {
      units += 1;
    }
  }
  return Math.max(1, Math.ceil(units / 4));
}

export function clampAiConfidence(raw: number, cap: number): number {
  if (!Number.isFinite(raw)) {
    return 0;
  }
  const c = Number.isFinite(cap) && cap > 0 ? cap : 0.92;
  return Math.max(0, Math.min(c, raw));
}

export function isNoOpTranslation(source: string, target: string): boolean {
  return source.trim().toLowerCase() === target.trim().toLowerCase();
}

export function applyNoOpAndCap(params: {
  canonicalText: string;
  translation: string;
  confidence: number;
  confidenceCap: number;
}): { translation: string; confidence: number; echo: boolean } {
  if (isNoOpTranslation(params.canonicalText, params.translation)) {
    return { translation: params.translation, confidence: 0.5, echo: true };
  }
  return {
    translation: params.translation,
    confidence: clampAiConfidence(params.confidence, params.confidenceCap),
    echo: false,
  };
}

export function shouldEscalateToConsensus(params: {
  mode: 'single' | 'consensus' | 'auto';
  llmConfidence: number;
  threshold: number;
  domainCode: string | null;
}): boolean {
  if (params.mode === 'consensus') {
    return true;
  }
  if (params.mode === 'single') {
    return false;
  }
  if (params.domainCode === null) {
    return true;
  }
  return params.llmConfidence < params.threshold;
}

export function mapConsensusMethodToConfidence(
  method: 'unanimous' | 'majority' | 'arbitration' | 'single_fallback',
  consensusScore: number,
  confidenceCap: number
): number {
  const score = Number.isFinite(consensusScore) ? consensusScore : 0;
  let v: number;
  if (method === 'unanimous') {
    v = 0.97;
  } else if (method === 'majority') {
    v = 0.85 + score * 0.1;
  } else if (method === 'arbitration') {
    v = Math.max(0.5, Math.min(0.95, score));
  } else {
    v = 0.7;
  }
  return clampAiConfidence(v, confidenceCap);
}

/* ──────────────────────────────────────────────────────────────────────────────
 * cluster-senses
 * ────────────────────────────────────────────────────────────────────────── */

export type ClusterContextInput = Readonly<{
  id: string;
  termId: string;
  representativeText: string;
  fieldKind: string | null;
  domainCode: string | null;
  taxonomyId: string | null;
  occurrencesCount: string;
}>;

export function buildGroupingKey(context: ClusterContextInput): string {
  return [
    context.domainCode ?? 'domain:none',
    context.taxonomyId ?? 'taxonomy:none',
    context.fieldKind ?? 'field:none',
  ].join('|');
}

export function clusterCompositeKey(termId: string, clusterKey: string): string {
  return `${termId}\x1f${clusterKey}`;
}

/* ──────────────────────────────────────────────────────────────────────────────
 * translate-candidates
 * ────────────────────────────────────────────────────────────────────────── */

export function summarizeConfidenceDistribution(scores: readonly number[]): {
  count: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  median: number | null;
} {
  const finite = scores.filter((x) => Number.isFinite(x));
  if (finite.length === 0) {
    return { count: 0, min: null, max: null, avg: null, median: null };
  }
  const sorted = [...finite].sort((a, b) => a - b);
  const first = sorted.at(0);
  const last = sorted.at(-1);
  if (first === undefined || last === undefined) {
    return { count: 0, min: null, max: null, avg: null, median: null };
  }
  const min = first;
  const max = last;
  const avg = finite.reduce((s, x) => s + x, 0) / finite.length;
  const mid = Math.floor(sorted.length / 2);
  let median: number;
  if (sorted.length % 2 === 1) {
    median = sorted[mid] ?? min;
  } else {
    const left = sorted[mid - 1];
    const right = sorted[mid];
    median = left === undefined || right === undefined ? min : (left + right) / 2;
  }
  return {
    count: finite.length,
    min,
    max,
    avg: Number(avg.toFixed(6)),
    median: Number(median.toFixed(6)),
  };
}

/* ──────────────────────────────────────────────────────────────────────────────
 * compose-localizations (shared string helper)
 * ────────────────────────────────────────────────────────────────────────── */

export function maybeAppend(base: string | null, nextValue: string | null): string | null {
  if (!nextValue) return base;
  if (!base) return nextValue;
  if (base.includes(nextValue)) return base;
  return `${base}\n\n${nextValue}`;
}
