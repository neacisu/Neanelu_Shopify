import { checkAndConsumeCost } from '@app/queue-manager';

export interface OpenAiEmbeddingRateLimitConfig {
  maxTokensPerMinute: number;
  maxRequestsPerMinute: number;
  bucketTtlMs: number;
}

export type OpenAiEmbeddingRateLimitResult = Readonly<{
  allowed: boolean;
  delayMs: number;
  tokensRemaining: number;
}>;

type RedisClient = Parameters<typeof checkAndConsumeCost>[0];

const DEFAULT_CONFIG: OpenAiEmbeddingRateLimitConfig = {
  maxTokensPerMinute: 1_000_000,
  maxRequestsPerMinute: 3_000,
  bucketTtlMs: 120_000,
};

function clampPositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
}

function perMinuteToPerSecond(value: number): number {
  return Math.max(1, Math.floor(value)) / 60;
}

function normalizeRedisPrefix(prefix: string | undefined): string {
  if (!prefix) return '';
  return prefix.endsWith(':') ? prefix : `${prefix}:`;
}

export async function gateOpenAiEmbeddingRequest(params: {
  redis: RedisClient;
  shopId: string;
  estimatedTokens: number;
  /**
   * Optional Redis key prefix (recommended) to keep environments isolated when Redis is shared.
   * If omitted, falls back to a global `neanelu:` namespace for backward compatibility.
   */
  redisPrefix?: string;
  config?: OpenAiEmbeddingRateLimitConfig;
}): Promise<OpenAiEmbeddingRateLimitResult> {
  const config = { ...DEFAULT_CONFIG, ...(params.config ?? {}) };
  const shopId = params.shopId.trim();
  if (!shopId) {
    throw new Error('openai_embed_rate_limit_shop_id_missing');
  }

  const estimatedTokens = clampPositiveInt(params.estimatedTokens, 1);

  const keyPrefix = normalizeRedisPrefix(params.redisPrefix);
  const tokenBucketSuffix = `ratelimit:openai-embed:tokens:${shopId}`;
  const requestBucketSuffix = `ratelimit:openai-embed:requests:${shopId}`;
  const tokenBucketKey = keyPrefix
    ? `${keyPrefix}${tokenBucketSuffix}`
    : `neanelu:${tokenBucketSuffix}`;
  const requestBucketKey = keyPrefix
    ? `${keyPrefix}${requestBucketSuffix}`
    : `neanelu:${requestBucketSuffix}`;

  const tokenCheck = await checkAndConsumeCost(params.redis, {
    bucketKey: tokenBucketKey,
    costToConsume: estimatedTokens,
    maxTokens: clampPositiveInt(config.maxTokensPerMinute, DEFAULT_CONFIG.maxTokensPerMinute),
    refillPerSecond: perMinuteToPerSecond(config.maxTokensPerMinute),
    ttlMs: clampPositiveInt(config.bucketTtlMs, DEFAULT_CONFIG.bucketTtlMs),
  });

  if (!tokenCheck.allowed) {
    return {
      allowed: false,
      delayMs: tokenCheck.delayMs,
      tokensRemaining: tokenCheck.tokensRemaining,
    };
  }

  const requestCheck = await checkAndConsumeCost(params.redis, {
    bucketKey: requestBucketKey,
    costToConsume: 1,
    maxTokens: clampPositiveInt(config.maxRequestsPerMinute, DEFAULT_CONFIG.maxRequestsPerMinute),
    refillPerSecond: perMinuteToPerSecond(config.maxRequestsPerMinute),
    ttlMs: clampPositiveInt(config.bucketTtlMs, DEFAULT_CONFIG.bucketTtlMs),
  });

  return {
    allowed: requestCheck.allowed,
    delayMs: requestCheck.delayMs,
    tokensRemaining: tokenCheck.tokensRemaining,
  };
}
