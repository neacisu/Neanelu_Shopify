import { Redis } from 'ioredis';
import { createHash } from 'crypto';

import type { ExternalProductSearchResult } from '../types/external-search.js';

let redisClient: Redis | null = null;
let rateLimiter: TokenBucketRateLimiter | null = null;

const CACHE_PREFIX = 'serper:cache:';

function getRedis(): Redis {
  if (!redisClient) {
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redisClient = new Redis(redisUrl, {
      enableReadyCheck: true,
      connectTimeout: 10_000,
      maxRetriesPerRequest: null,
    });
  }
  return redisClient;
}

export function getSerperRateLimiter(): TokenBucketRateLimiter {
  if (!rateLimiter) {
    const rateLimit = Number(process.env['SERPER_RATE_LIMIT_PER_SECOND'] ?? 10);
    rateLimiter = new TokenBucketRateLimiter(rateLimit);
  }
  return rateLimiter;
}

export async function getCachedResult(key: string): Promise<ExternalProductSearchResult[] | null> {
  const redis = getRedis();
  const cached = await redis.get(CACHE_PREFIX + hashKey(key));
  if (!cached) return null;
  try {
    return JSON.parse(cached) as ExternalProductSearchResult[];
  } catch {
    return null;
  }
}

export async function setCachedResult(
  key: string,
  results: ExternalProductSearchResult[]
): Promise<void> {
  const ttl = Number(process.env['SERPER_CACHE_TTL_SECONDS'] ?? 86400);
  const redis = getRedis();
  await redis.setex(CACHE_PREFIX + hashKey(key), ttl, JSON.stringify(results));
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;

  constructor(requestsPerSecond: number) {
    this.maxTokens = Math.max(1, requestsPerSecond);
    this.tokens = this.maxTokens;
    this.refillRate = this.maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens < 1) {
      const waitTimeMs = ((1 - this.tokens) / this.refillRate) * 1000;
      await new Promise((resolve) => setTimeout(resolve, waitTimeMs));
      this.refill();
    }
    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsedSeconds * this.refillRate);
    this.lastRefill = now;
  }
}
