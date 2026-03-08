import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateDualEmbeddings,
  generateDualEmbeddingsBatch,
  mergeMultiModelCandidates,
} from '../multi-model-embedding.js';

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as const;

void describe('multi-model-embedding', () => {
  void it('mergeMultiModelCandidates deduplica si pastreaza scorul maxim', () => {
    const merged = mergeMultiModelCandidates(
      [
        { id: 'a', name: 'Alpha', similarity: 0.61 },
        { id: 'b', name: 'Beta', similarity: 0.72 },
        { id: 'c', name: 'Gamma', similarity: 0.44 },
      ],
      [
        { id: 'b', name: 'Beta', similarity: 0.81 },
        { id: 'd', name: 'Delta', similarity: 0.67 },
      ],
      'prod_taxonomy'
    );

    assert.deepEqual(
      merged.map((item) => [item.id, item.similarity]),
      [
        ['b', 0.81],
        ['d', 0.67],
        ['a', 0.61],
        ['c', 0.44],
      ]
    );
  });

  void it('generateDualEmbeddings revine graceful cand secundarul esueaza', async () => {
    const result = await generateDualEmbeddings({
      shopId: 'shop-1',
      env: { consensusEmbeddingSecondaryEnabled: true } as never,
      logger: logger as never,
      text: 'Boilers and accessories',
      primary: {
        kind: 'selfhosted',
        model: { name: 'qwen3-embedding', dimensions: 3 },
        isAvailable: () => true,
        embedTexts: () => Promise.resolve([[0.1, 0.2, 0.3]]),
      } as never,
      secondary: {
        kind: 'openai',
        model: { name: 'text-embedding-3-large', dimensions: 3 },
        isAvailable: () => true,
        embedTexts: () => Promise.reject(new Error('secondary failed')),
      } as never,
    });

    assert.equal(result.primaryModel, 'qwen3-embedding');
    assert.equal(result.secondaryEmbedding, null);
    assert.equal(result.secondaryModel, null);
    assert.deepEqual(result.primaryEmbedding, [0.1, 0.2, 0.3]);
  });

  void it('generateDualEmbeddingsBatch produce embeddings pentru ambele modele', async () => {
    const result = await generateDualEmbeddingsBatch({
      shopId: 'shop-1',
      env: { consensusEmbeddingSecondaryEnabled: true } as never,
      logger: logger as never,
      texts: ['one', 'two'],
      primary: {
        kind: 'selfhosted',
        model: { name: 'qwen3-embedding', dimensions: 2 },
        isAvailable: () => true,
        embedTexts: () =>
          Promise.resolve([
            [0.1, 0.2],
            [0.3, 0.4],
          ]),
      } as never,
      secondary: {
        kind: 'openai',
        model: { name: 'text-embedding-3-large', dimensions: 2 },
        isAvailable: () => true,
        embedTexts: () =>
          Promise.resolve([
            [1, 2],
            [3, 4],
          ]),
      } as never,
    });

    assert.equal(result.primaryModel, 'qwen3-embedding');
    assert.equal(result.secondaryModel, 'text-embedding-3-large');
    assert.equal(result.primaryEmbeddings.length, 2);
    assert.equal(result.secondaryEmbeddings?.length, 2);
  });
});
