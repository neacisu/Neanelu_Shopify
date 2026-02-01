import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Redis } from 'ioredis';

import { getCachedSearchResult, setCachedSearchResult, invalidateSearchCache } from '../cache.js';

class MockRedis {
  private store = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  set(key: string, value: string, _mode: string, _ttl: number): Promise<'OK'> {
    this.store.set(key, value);
    return Promise.resolve('OK');
  }

  scan(cursor: string, _match: string, pattern: string): Promise<[string, string[]]> {
    const keys = Array.from(this.store.keys()).filter((key) => matchPattern(key, pattern));
    return Promise.resolve([cursor === '0' ? '0' : '0', keys]);
  }

  pipeline() {
    const keys: string[] = [];
    return {
      del: (key: string) => {
        keys.push(key);
        return undefined;
      },
      exec: () => {
        const results: [null, number][] = [];
        for (const key of keys) {
          const removed = this.store.delete(key) ? 1 : 0;
          results.push([null, removed]);
        }
        return Promise.resolve(results);
      },
    };
  }
}

function matchPattern(value: string, pattern: string): boolean {
  if (pattern.endsWith('*')) {
    return value.startsWith(pattern.slice(0, -1));
  }
  return value === pattern;
}

void describe('search cache', () => {
  void it('returns null for cache miss', async () => {
    const redis = new MockRedis();
    const result = await getCachedSearchResult({
      redis: redis as unknown as Redis,
      shopId: 'shop-1',
      queryText: 'iphone case',
    });
    assert.equal(result, null);
  });

  void it('sets and reads cached search results', async () => {
    const redis = new MockRedis();
    await setCachedSearchResult({
      redis: redis as unknown as Redis,
      shopId: 'shop-1',
      queryText: 'iphone case',
      result: [{ id: 'p1', title: 'iPhone Case', similarity: 0.9 }],
      vectorSearchTimeMs: 25,
      totalCount: 1,
    });

    const cached = await getCachedSearchResult({
      redis: redis as unknown as Redis,
      shopId: 'shop-1',
      queryText: 'iphone case',
    });

    assert.ok(cached);
    assert.equal(cached?.results.length, 1);
    assert.equal(cached?.results[0]?.id, 'p1');
  });

  void it('invalidates cache keys for a shop', async () => {
    const redis = new MockRedis();
    await setCachedSearchResult({
      redis: redis as unknown as Redis,
      shopId: 'shop-1',
      queryText: 'iphone case',
      result: [{ id: 'p1', title: 'iPhone Case', similarity: 0.9 }],
      vectorSearchTimeMs: 25,
      totalCount: 1,
    });
    await setCachedSearchResult({
      redis: redis as unknown as Redis,
      shopId: 'shop-2',
      queryText: 'iphone case',
      result: [{ id: 'p2', title: 'Other', similarity: 0.9 }],
      vectorSearchTimeMs: 25,
      totalCount: 1,
    });

    const deleted = await invalidateSearchCache({
      redis: redis as unknown as Redis,
      shopId: 'shop-1',
    });

    assert.equal(deleted > 0, true);
    const cached = await getCachedSearchResult({
      redis: redis as unknown as Redis,
      shopId: 'shop-1',
      queryText: 'iphone case',
    });
    assert.equal(cached, null);
  });
});
