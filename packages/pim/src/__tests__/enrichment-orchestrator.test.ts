import { describe, expect, it, vi } from 'vitest';

import { EnrichmentOrchestrator } from '../services/enrichment-orchestrator.js';
import { calculateProductPriority, toBullMQPriority } from '../services/enrichment-priority.js';
import {
  canProcessProduct,
  filterUnprocessedProducts,
  markProductProcessed,
} from '../services/enrichment-dedup.js';

describe('enrichment-priority', () => {
  it('calculeaza P1 pentru scor >= 0.7 si GTIN', () => {
    expect(calculateProductPriority({ qualityScore: 0.8, gtin: '123' })).toBe(1);
  });

  it('calculeaza P2 pentru scor >= 0.5', () => {
    expect(calculateProductPriority({ qualityScore: 0.6 })).toBe(2);
  });

  it('calculeaza P2 pentru dataQualityLevel silver', () => {
    expect(calculateProductPriority({ qualityScore: 0.1, dataQualityLevel: 'silver' })).toBe(2);
  });

  it('calculeaza P3 pentru restul cazurilor', () => {
    expect(calculateProductPriority({ qualityScore: 0.1 })).toBe(3);
  });

  it('mapeaza corect prioritatea BullMQ', () => {
    expect(toBullMQPriority(1)).toBe(10);
    expect(toBullMQPriority(2)).toBe(20);
    expect(toBullMQPriority(3)).toBe(30);
  });
});

describe('enrichment-dedup', () => {
  it('canProcessProduct returneaza true cand cheia nu exista', async () => {
    const redis = { exists: vi.fn().mockResolvedValue(0) };
    await expect(canProcessProduct(redis as never, 'prod-1')).resolves.toBe(true);
  });

  it('markProductProcessed seteaza TTL corect', async () => {
    const redis = { setex: vi.fn().mockResolvedValue('OK') };
    await markProductProcessed(redis as never, 'prod-1');
    expect(redis.setex).toHaveBeenCalledWith('enrichment:dedup:prod-1', 86400, expect.any(String));
  });

  it('filterUnprocessedProducts filtreaza pe baza exists', async () => {
    const pipeline = {
      exists: vi.fn(),
      exec: vi.fn().mockResolvedValue([
        [null, 0],
        [null, 1],
        [null, 0],
      ]),
    };
    const redis = {
      pipeline: vi.fn().mockReturnValue(pipeline),
    };
    const result = await filterUnprocessedProducts(redis as never, ['a', 'b', 'c']);
    expect(result).toEqual(['a', 'c']);
    expect(pipeline.exists).toHaveBeenCalledTimes(3);
  });
});

describe('enrichment-orchestrator', () => {
  it('dispatch-eaza produse si aplica dedup + priority', async () => {
    const redis = {
      exists: vi.fn().mockResolvedValue(0),
      setex: vi.fn().mockResolvedValue('OK'),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const enqueueSimilaritySearchJob = vi.fn().mockResolvedValue('job-1');
    const orchestrator = new EnrichmentOrchestrator(
      redis as never,
      logger,
      enqueueSimilaritySearchJob
    );

    const result = await orchestrator.dispatchForEnrichment('shop-1', [
      { productId: 'prod-1', shopifyProductId: 'shopify-1', qualityScore: 0.8, gtin: '123' },
      { productId: 'prod-2', shopifyProductId: 'shopify-2', qualityScore: 0.2 },
    ]);

    expect(result.dispatched).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.byPriority.p1).toBe(1);
    expect(result.byPriority.p3).toBe(1);
    expect(enqueueSimilaritySearchJob).toHaveBeenCalledTimes(2);
  });

  // fetchProductsForEnrichment is implemented in backend-worker to avoid cross-package imports.
});
