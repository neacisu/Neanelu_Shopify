import { load } from 'cheerio';

import type { JsonLdProduct } from '../scrapers/types.js';

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function isRelevantType(type: unknown): boolean {
  const all = toArray(type).map((item) => String(item).toLowerCase());
  return all.includes('product') || all.includes('offer') || all.includes('aggregateoffer');
}

function flattenJsonLdNode(value: unknown): JsonLdProduct[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenJsonLdNode(item));
  }
  if (!value || typeof value !== 'object') return [];
  const node = value as Record<string, unknown>;
  if (Array.isArray(node['@graph'])) {
    return node['@graph'].flatMap((item) => flattenJsonLdNode(item));
  }
  if (isRelevantType(node['@type'])) {
    return [node as JsonLdProduct];
  }
  return [];
}

export function extractJsonLd(html: string): JsonLdProduct[] {
  const $ = load(html);
  const results: JsonLdProduct[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      results.push(...flattenJsonLdNode(parsed));
    } catch {
      // ignore invalid JSON-LD blocks
    }
  });

  return results;
}
