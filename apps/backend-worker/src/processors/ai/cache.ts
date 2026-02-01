import type { Redis } from 'ioredis';

import { sha256Hex } from '@app/ai-engine';
import type { ProductSearchResult } from '@app/types';

import { normalizeSearchQuery } from './normalization.js';

export interface SearchCacheConfig {
  ttlSeconds: number;
  maxResultSize: number;
  maxKeysToDelete: number;
}

export type CachedSearchResult = Readonly<{
  results: ProductSearchResult[];
  vectorSearchTimeMs: number;
  totalCount: number;
  cachedAt: string;
}>;

// Cache invalidation strategy: TTL-based by default.
// Optional: call invalidateSearchCache() from product update handlers if needed.
const DEFAULT_TTL_SECONDS = 60 * 60;
const DEFAULT_MAX_RESULT_SIZE = 50 * 1024;
const DEFAULT_MAX_KEYS_TO_DELETE = 2000;

function normalizeQuery(text: string): string {
  return normalizeSearchQuery(text);
}

export function getSearchCacheKey(shopId: string, queryHash: string): string {
  return `cache:search:${shopId}:${queryHash}`;
}

export async function getCachedSearchResult(params: {
  redis: Redis;
  shopId: string;
  queryText: string;
  config?: Partial<SearchCacheConfig>;
}): Promise<CachedSearchResult | null> {
  const normalized = normalizeQuery(params.queryText);
  if (!normalized) return null;
  const key = getSearchCacheKey(params.shopId, sha256Hex(normalized));
  const raw = await params.redis.get(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedSearchResult;
    if (!parsed || !Array.isArray(parsed.results)) return null;
    if (typeof parsed.totalCount !== 'number') {
      return {
        ...parsed,
        totalCount: parsed.results.length,
      };
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function setCachedSearchResult(params: {
  redis: Redis;
  shopId: string;
  queryText: string;
  result: ProductSearchResult[];
  vectorSearchTimeMs: number;
  totalCount: number;
  config?: Partial<SearchCacheConfig>;
}): Promise<void> {
  const config = params.config ?? {};
  const ttlSeconds = config.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const maxResultSize = config.maxResultSize ?? DEFAULT_MAX_RESULT_SIZE;

  const normalized = normalizeQuery(params.queryText);
  if (!normalized) return;
  const key = getSearchCacheKey(params.shopId, sha256Hex(normalized));

  const payload: CachedSearchResult = {
    results: params.result,
    vectorSearchTimeMs: params.vectorSearchTimeMs,
    totalCount: params.totalCount,
    cachedAt: new Date().toISOString(),
  };

  const raw = JSON.stringify(payload);
  if (raw.length > maxResultSize) return;

  await params.redis.set(key, raw, 'EX', ttlSeconds);
}

export async function invalidateSearchCache(params: {
  redis: Redis;
  shopId: string;
  config?: Partial<SearchCacheConfig>;
}): Promise<number> {
  const config = params.config ?? {};
  const maxKeys = config.maxKeysToDelete ?? DEFAULT_MAX_KEYS_TO_DELETE;
  const pattern = `cache:search:${params.shopId}:*`;

  let cursor = '0';
  let deleted = 0;

  do {
    const result = await params.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    const nextCursor = result?.[0];
    const keys = result?.[1] ?? [];
    if (keys.length) {
      const remaining = Math.max(0, maxKeys - deleted);
      const toDelete = keys.slice(0, remaining);
      if (toDelete.length) {
        const pipeline = params.redis.pipeline();
        for (const key of toDelete) pipeline.del(key);
        const exec = await pipeline.exec();
        deleted +=
          exec?.reduce((acc, item) => {
            const n = Array.isArray(item) ? item[1] : 0;
            return acc + (typeof n === 'number' ? n : 0);
          }, 0) ?? 0;
      }
    }
    cursor = typeof nextCursor === 'string' ? nextCursor : '0';
  } while (cursor !== '0' && deleted < maxKeys);

  return deleted;
}
