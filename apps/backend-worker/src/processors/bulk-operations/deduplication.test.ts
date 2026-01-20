import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { checkDuplicateForShopifyProduct } from './deduplication.js';

const fakeProvider = {
  kind: 'openai' as const,
  model: { name: 'test', dimensions: 2 },
  isAvailable: () => true,
  embedTexts: () => Promise.resolve([[0.1, 0.2]] as const),
};

void describe('deduplication: checkDuplicateForShopifyProduct', () => {
  void it('flags semantic duplicate when similarity exceeds high threshold', async () => {
    const client = {
      query: <T>(sql: string): Promise<{ rows: T[] }> => {
        if (sql.toLowerCase().includes('find_similar_products')) {
          return Promise.resolve({
            rows: [
              {
                product_id: 'prod-1',
                similarity: 0.95,
                title: 'Hat',
                brand: 'Brand',
              } as T,
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      },
    };

    const result = await checkDuplicateForShopifyProduct({
      client,
      gtin: null,
      title: 'Hat',
      vendor: 'Brand',
      thresholds: { highConfidence: 0.9, suspicious: 0.8 },
      semanticEnabled: true,
      embeddingsProvider: fakeProvider,
      maxResults: 5,
    });

    assert.equal(result.decision.kind, 'semantic_duplicate');
    assert.equal(result.decision.existingProductId, 'prod-1');
  });

  void it('flags suspicious when similarity is between thresholds', async () => {
    const client = {
      query: <T>(sql: string): Promise<{ rows: T[] }> => {
        if (sql.toLowerCase().includes('find_similar_products')) {
          return Promise.resolve({
            rows: [
              {
                product_id: 'prod-2',
                similarity: 0.82,
                title: 'Shoe',
                brand: 'Brand',
              } as T,
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      },
    };

    const result = await checkDuplicateForShopifyProduct({
      client,
      gtin: null,
      title: 'Shoe',
      vendor: 'Brand',
      thresholds: { highConfidence: 0.9, suspicious: 0.8 },
      semanticEnabled: true,
      embeddingsProvider: fakeProvider,
      maxResults: 5,
    });

    assert.equal(result.decision.kind, 'suspicious');
    assert.equal(result.decision.candidateProductId, 'prod-2');
  });

  void it('falls back to unique when semantic is disabled', async () => {
    const client = {
      query: <T>(_sql: string): Promise<{ rows: T[] }> => Promise.resolve({ rows: [] }),
    };

    const result = await checkDuplicateForShopifyProduct({
      client,
      gtin: null,
      title: 'Unique',
      vendor: 'Brand',
      thresholds: { highConfidence: 0.9, suspicious: 0.8 },
      semanticEnabled: false,
      embeddingsProvider: fakeProvider,
      maxResults: 5,
    });

    assert.equal(result.decision.kind, 'unique');
  });
});
