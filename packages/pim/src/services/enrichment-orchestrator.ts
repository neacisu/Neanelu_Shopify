import type { Redis } from 'ioredis';

import { releaseProductReservation, tryReserveProduct } from './enrichment-dedup.js';
import { calculateProductPriority, toBullMQPriority } from './enrichment-priority.js';

export type EnrichmentLogger = Readonly<{
  info: (context: Record<string, unknown>, message: string) => void;
}>;

export type EnqueueSimilaritySearchJob = (params: {
  shopId: string;
  productId: string;
  priority?: number;
}) => Promise<unknown>;

export type ProductForEnrichment = Readonly<{
  productId: string;
  shopifyProductId: string;
  qualityScore?: number | null;
  gtin?: string | null;
  dataQualityLevel?: string | null;
}>;

export type EnrichmentDispatchResult = Readonly<{
  dispatched: number;
  skipped: number;
  byPriority: { p1: number; p2: number; p3: number };
}>;

export class EnrichmentOrchestrator {
  constructor(
    private readonly redis: Redis,
    private readonly logger: EnrichmentLogger,
    private readonly enqueueSimilaritySearchJob: EnqueueSimilaritySearchJob
  ) {}

  async dispatchForEnrichment(
    shopId: string,
    products: ProductForEnrichment[]
  ): Promise<EnrichmentDispatchResult> {
    let dispatched = 0;
    let skipped = 0;
    const byPriority = { p1: 0, p2: 0, p3: 0 };

    for (const product of products) {
      const reserved = await tryReserveProduct(this.redis, product.productId);
      if (!reserved) {
        skipped++;
        continue;
      }

      const priority = calculateProductPriority({
        ...(product.qualityScore !== undefined ? { qualityScore: product.qualityScore } : {}),
        ...(product.gtin !== undefined ? { gtin: product.gtin } : {}),
        ...(product.dataQualityLevel !== undefined
          ? { dataQualityLevel: product.dataQualityLevel }
          : {}),
      });
      const bullmqPriority = toBullMQPriority(priority);

      try {
        await this.enqueueSimilaritySearchJob({
          shopId,
          productId: product.shopifyProductId,
          priority: bullmqPriority,
        });
      } catch (error) {
        // If enqueue fails, release the reservation so we can retry later.
        await releaseProductReservation(this.redis, product.productId);
        throw error;
      }

      dispatched++;
      if (priority === 1) byPriority.p1++;
      else if (priority === 2) byPriority.p2++;
      else byPriority.p3++;
    }

    this.logger.info(
      { shopId, dispatched, skipped, byPriority },
      'Enrichment batch dispatched to similarity-search queue'
    );

    return { dispatched, skipped, byPriority };
  }
}
