import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBatchJsonlLines,
  buildCustomId,
  buildShopifyEmbeddingContent,
  computeEmbeddingCandidates,
  filterCleanupCandidates,
  parseBatchErrorLines,
  parseBatchOutputLines,
  parseCustomId,
} from '../batch.js';

void describe('AI batch utils', () => {
  void it('buildShopifyEmbeddingContent is deterministic and strips HTML', () => {
    const product = {
      id: 'p1',
      title: '  Apa Minerala  ',
      description: null,
      descriptionHtml: '<p>Descriere&nbsp;<strong>bogata</strong></p>',
      vendor: 'Neanelu',
      productType: 'Bauturi',
      tags: ['hidratare', ' naturale '],
    };

    const first = buildShopifyEmbeddingContent({ product, embeddingType: 'combined' });
    const second = buildShopifyEmbeddingContent({ product, embeddingType: 'combined' });

    assert.equal(first.content, second.content);
    assert.equal(first.contentHash, second.contentHash);
    assert.ok(first.content.includes('Titlu: Apa Minerala'));
    assert.ok(first.content.includes('Descriere: Descriere bogata'));
  });

  void it('computeEmbeddingCandidates filters unchanged content', () => {
    const productA = {
      id: 'prod-a',
      title: 'Produs A',
      description: 'Desc A',
      descriptionHtml: null,
      vendor: 'Brand',
      productType: 'Type',
      tags: [],
    };
    const productB = { ...productA, id: 'prod-b', title: 'Produs B' };

    const hashA = buildShopifyEmbeddingContent({
      product: productA,
      embeddingType: 'combined',
    }).contentHash;
    const existing = new Map([
      ['prod-a', { productId: 'prod-a', contentHash: hashA, status: 'ready' }],
    ]);

    const result = computeEmbeddingCandidates({
      products: [productA, productB],
      existing,
      embeddingType: 'combined',
    });

    assert.equal(result.unchanged, 1);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0]?.productId, 'prod-b');
  });

  void it('computeEmbeddingCandidates retries failed embeddings', () => {
    const product = {
      id: 'prod-fail',
      title: 'Produs Fail',
      description: 'Desc',
      descriptionHtml: null,
      vendor: 'Brand',
      productType: 'Type',
      tags: [],
    };

    const hash = buildShopifyEmbeddingContent({
      product,
      embeddingType: 'combined',
    }).contentHash;

    const existing = new Map([
      ['prod-fail', { productId: 'prod-fail', contentHash: hash, status: 'failed' }],
    ]);

    const result = computeEmbeddingCandidates({
      products: [product],
      existing,
      embeddingType: 'combined',
    });

    assert.equal(result.retryable, 1);
    assert.equal(result.candidates.length, 1);
  });

  void it('buildCustomId and parseCustomId roundtrip', () => {
    const customId = buildCustomId({
      productId: 'prod-1',
      embeddingType: 'combined',
      contentHash: 'abc123',
    });
    const parsed = parseCustomId(customId);
    assert.deepEqual(parsed, {
      productId: 'prod-1',
      embeddingType: 'combined',
      contentHash: 'abc123',
    });
  });

  void it('buildBatchJsonlLines generates OpenAI batch payload', () => {
    const lines = buildBatchJsonlLines({
      candidates: [{ productId: 'p1', content: 'hello', contentHash: 'hash1' }],
      embeddingType: 'combined',
      model: 'text-embedding-3-large',
      dimensions: 2000,
    });

    const parsed = JSON.parse(lines[0] ?? '{}') as {
      custom_id?: string;
      method?: string;
      url?: string;
      body?: { model?: string; input?: string; dimensions?: number };
    };

    assert.equal(parsed.method, 'POST');
    assert.equal(parsed.url, '/v1/embeddings');
    assert.equal(parsed.body?.model, 'text-embedding-3-large');
    assert.equal(parsed.body?.input, 'hello');
    assert.equal(parsed.body?.dimensions, 2000);
    assert.ok(parsed.custom_id?.includes('hash1'));
  });

  void it('parseBatchOutputLines extracts embeddings and errors', () => {
    const lines = [
      JSON.stringify({
        custom_id: 'prod-1|combined|hash1',
        response: {
          status_code: 200,
          body: { data: [{ embedding: [0.1, 0.2] }], usage: { total_tokens: 7 } },
        },
      }),
      JSON.stringify({
        custom_id: 'prod-2|combined|hash2',
        response: { status_code: 500 },
        error: { message: 'boom' },
      }),
    ];

    const records = parseBatchOutputLines(lines);
    assert.equal(records.length, 2);
    assert.deepEqual(records[0]?.embedding, [0.1, 0.2]);
    assert.equal(records[0]?.tokensUsed, 7);
    assert.equal(records[1]?.errorMessage, 'boom');
  });

  void it('parseBatchErrorLines extracts error entries', () => {
    const lines = [
      JSON.stringify({ custom_id: 'prod-1|combined|hash1', error: { message: 'bad' } }),
    ];
    const records = parseBatchErrorLines(lines);
    assert.deepEqual(records, [{ customId: 'prod-1|combined|hash1', errorMessage: 'bad' }]);
  });

  void it('filterCleanupCandidates respects retention window', () => {
    const now = Date.now();
    const rows = [
      {
        id: 'a',
        inputFileId: 'f1',
        outputFileId: null,
        errorFileId: null,
        completedAtIso: new Date(now - 40 * 86400 * 1000).toISOString(),
        submittedAtIso: null,
        createdAtIso: null,
      },
      {
        id: 'b',
        inputFileId: 'f2',
        outputFileId: null,
        errorFileId: null,
        completedAtIso: new Date(now - 5 * 86400 * 1000).toISOString(),
        submittedAtIso: null,
        createdAtIso: null,
      },
    ];

    const filtered = filterCleanupCandidates({ rows, retentionDays: 30, nowMs: now });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.id, 'a');
  });
});
