import type { Redis } from 'ioredis';

const DEDUP_TTL_SECONDS = 24 * 60 * 60;
const DEDUP_PREFIX = 'enrichment:dedup:';

export async function canProcessProduct(redis: Redis, productId: string): Promise<boolean> {
  const key = `${DEDUP_PREFIX}${productId}`;
  const exists = await redis.exists(key);
  return exists === 0;
}

export async function markProductProcessed(redis: Redis, productId: string): Promise<void> {
  const key = `${DEDUP_PREFIX}${productId}`;
  await redis.setex(key, DEDUP_TTL_SECONDS, Date.now().toString());
}

export async function filterUnprocessedProducts(
  redis: Redis,
  productIds: string[]
): Promise<string[]> {
  if (productIds.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const id of productIds) {
    pipeline.exists(`${DEDUP_PREFIX}${id}`);
  }
  const results = await pipeline.exec();

  return productIds.filter((_, idx) => results?.[idx]?.[1] === 0);
}
