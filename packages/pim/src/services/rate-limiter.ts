import type { Redis } from 'ioredis';
import { loadEnv } from '@app/config';
import { createManagedRedis } from '@app/database';
import type { ApiProvider } from './cost-tracker.js';

let redisClient: Redis | null = null;

function getRedis(): Redis {
  if (!redisClient) {
    const env = loadEnv();
    redisClient = createManagedRedis('pim-provider-rate-limiter', {
      enableReadyCheck: true,
      connectTimeout: 10_000,
      maxRetriesPerRequest: null,
      keyPrefix: env.redisPrefix,
    });
  }
  return redisClient;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function acquireProviderRateLimit(params: {
  provider: ApiProvider;
  shopId: string;
  rateLimitPerMinute: number;
}): Promise<void> {
  const { provider, shopId, rateLimitPerMinute } = params;
  if (!Number.isFinite(rateLimitPerMinute) || rateLimitPerMinute <= 0) {
    return;
  }
  const limit = Math.max(1, Math.floor(rateLimitPerMinute));
  const redis = getRedis();
  const key = `rl:${provider}:${shopId}`;

  while (true) {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, 60);
    }

    if (count <= limit) {
      return;
    }

    const ttl = await redis.ttl(key);
    const waitMs = ttl > 0 ? ttl * 1000 : 1000;
    await sleep(waitMs);
  }
}
