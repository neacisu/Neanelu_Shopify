import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { EmbeddingsProvider } from '@app/ai-engine';
import type { PoolClient } from 'pg';

import { generateQueryEmbedding, searchSimilarProducts } from '../search.js';

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  child: () => logger,
};

void describe('ai search processor', () => {
  void it('generateQueryEmbedding throws on empty query', async () => {
    const provider: EmbeddingsProvider = {
      kind: 'noop',
      model: { name: 'noop', dimensions: 3 },
      isAvailable: () => false,
      embedTexts: () => Promise.resolve([[0, 0, 0]]),
    };

    await assert.rejects(
      () =>
        generateQueryEmbedding({
          text: '   ',
          provider,
          logger,
        }),
      /SEARCH_QUERY_EMPTY/
    );
  });

  void it('generateQueryEmbedding returns first embedding', async () => {
    const provider: EmbeddingsProvider = {
      kind: 'openai',
      model: { name: 'text-embedding-3-large', dimensions: 3 },
      isAvailable: () => true,
      embedTexts: () =>
        Promise.resolve([
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
        ]),
    };

    const embedding = await generateQueryEmbedding({
      text: 'iPhone case',
      provider,
      logger,
    });

    assert.deepEqual(embedding, [0.1, 0.2, 0.3]);
  });

  void it('searchSimilarProducts runs HNSW search query', async () => {
    const queries: { sql: string; params?: unknown[] | undefined }[] = [];
    const client = {
      query: (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes('SET LOCAL hnsw.ef_search')) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        return Promise.resolve({
          rows: [
            {
              productId: 'prod-1',
              title: 'Test Product',
              embeddingType: 'combined',
              qualityLevel: 'bronze',
              similarity: 0.92,
            },
          ],
          rowCount: 1,
        });
      },
    } as unknown as PoolClient;

    const results = await searchSimilarProducts({
      client,
      shopId: 'shop-1',
      embedding: [0.1, 0.2, 0.3],
      limit: 20,
      threshold: 0.7,
      logger,
    });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.productId, 'prod-1');
    assert.ok(queries[0]?.sql.includes('SET LOCAL hnsw.ef_search'));
    assert.ok(queries[1]?.sql.includes('find_similar_shop_products'));
  });
});
