import { SerperResponseSchema } from '../schemas/serper-search.js';
import { getCachedResult, getSerperRateLimiter, setCachedResult } from './serper-rate-limiter.js';
import { trackSerperCost } from './serper-cost-tracker.js';
import { storeRawHarvest } from './raw-harvest-storage.js';
import { hasEnoughConfirmedMatches } from '../repositories/similarity-matches.js';
import type { ExternalProductSearchResult, SerperSearchOptions } from '../types/external-search.js';

const SERPER_ENDPOINT = 'https://google.serper.dev/search';

export async function searchProductByGTIN(
  gtin: string,
  productId?: string,
  shopId?: string
): Promise<ExternalProductSearchResult[]> {
  if (productId && (await hasEnoughConfirmedMatches(productId, 3))) {
    return [];
  }
  return executeSearch({ query: gtin, searchType: 'search' }, productId, shopId);
}

export async function searchProductByMPN(
  brand: string,
  mpn: string,
  productId?: string,
  shopId?: string
): Promise<ExternalProductSearchResult[]> {
  if (productId && (await hasEnoughConfirmedMatches(productId, 3))) {
    return [];
  }
  return executeSearch({ query: `${brand} ${mpn}`, searchType: 'search' }, productId, shopId);
}

export async function searchProductByTitle(
  title: string,
  brand?: string,
  productId?: string,
  shopId?: string
): Promise<ExternalProductSearchResult[]> {
  if (productId && (await hasEnoughConfirmedMatches(productId, 3))) {
    return [];
  }
  const query = brand ? `${brand} ${title}` : title;
  return executeSearch({ query, searchType: 'search' }, productId, shopId);
}

export async function searchProductShopping(
  query: string,
  productId?: string,
  shopId?: string
): Promise<ExternalProductSearchResult[]> {
  if (productId && (await hasEnoughConfirmedMatches(productId, 3))) {
    return [];
  }
  return executeSearch({ query, searchType: 'shopping' }, productId, shopId);
}

async function executeSearch(
  options: SerperSearchOptions,
  productId?: string,
  shopId?: string
): Promise<ExternalProductSearchResult[]> {
  const apiKey = process.env['SERPER_API_KEY'];
  if (!apiKey) {
    throw new Error('SERPER_API_KEY is not configured');
  }

  const cacheKey = buildCacheKey(options);
  const cached = await getCachedResult(cacheKey);
  if (cached) {
    return cached;
  }

  const rateLimiter = getSerperRateLimiter();
  await rateLimiter.acquire();

  const startTime = Date.now();
  let httpStatus = 0;

  try {
    const response = await fetch(SERPER_ENDPOINT, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: options.query,
        gl: options.gl ?? 'ro',
        hl: options.hl ?? 'ro',
        num: options.num ?? 10,
        type: options.searchType ?? 'search',
      }),
    });

    httpStatus = response.status;
    const responseTimeMs = Date.now() - startTime;

    if (!response.ok) {
      throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
    }

    const rawData = await response.json();
    const parsed = SerperResponseSchema.parse(rawData);

    await storeRawHarvest({
      sourceUrl: `serper://${options.searchType ?? 'search'}?q=${encodeURIComponent(options.query)}`,
      rawJson: rawData,
    });

    await trackSerperCost({
      endpoint: options.searchType ?? 'search',
      ...(shopId ? { shopId } : {}),
      httpStatus,
      responseTimeMs,
      ...(productId ? { productId } : {}),
    });

    const results = convertToExternalResults(parsed);
    await setCachedResult(cacheKey, results);

    return results;
  } catch (error) {
    await trackSerperCost({
      endpoint: options.searchType ?? 'search',
      ...(shopId ? { shopId } : {}),
      httpStatus,
      responseTimeMs: Date.now() - startTime,
      ...(productId ? { productId } : {}),
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

function buildCacheKey(options: SerperSearchOptions): string {
  return `serper:${options.searchType ?? 'search'}:${options.query}:${options.gl ?? 'ro'}`;
}

function convertToExternalResults(
  parsed: ReturnType<typeof SerperResponseSchema.parse>
): ExternalProductSearchResult[] {
  const results: ExternalProductSearchResult[] = [];

  for (const item of parsed.organic ?? []) {
    const base = {
      title: item.title,
      url: item.link,
      position: item.position,
      source: 'organic',
    } satisfies ExternalProductSearchResult;
    results.push({
      ...base,
      ...(item.snippet ? { snippet: item.snippet } : {}),
    });
  }

  for (const item of parsed.shopping ?? []) {
    const structuredData =
      item.price || item.rating !== undefined
        ? {
            ...(item.price ? { price: item.price } : {}),
            ...(item.rating !== undefined ? { rating: item.rating } : {}),
          }
        : undefined;
    results.push({
      title: item.title,
      url: item.link,
      position: results.length + 1,
      source: 'shopping',
      ...(structuredData ? { structuredData } : {}),
    });
  }

  if (parsed.knowledgeGraph?.title) {
    const base = {
      title: parsed.knowledgeGraph.title,
      url: parsed.knowledgeGraph.descriptionLink ?? '',
      position: 0,
      source: 'knowledge_graph',
    } satisfies ExternalProductSearchResult;
    results.unshift({
      ...base,
      ...(parsed.knowledgeGraph.description ? { snippet: parsed.knowledgeGraph.description } : {}),
    });
  }

  return results;
}
