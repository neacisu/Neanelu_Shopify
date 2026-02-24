import { checkAndConsumeCost } from '@app/queue-manager';
import { ShopifyRateLimitedError, type ShopifyGraphqlThrottleStatus } from '@app/shopify-client';
import type { Redis } from 'ioredis';

function resolveRedisKeyPrefix(env: Record<string, string | undefined> = process.env): string {
  return (env['REDIS_PREFIX'] ?? env['BULLMQ_PREFIX'] ?? '').trim();
}

function graphqlBucketKey(
  shopId: string,
  env: Record<string, string | undefined> = process.env
): string {
  const prefix = resolveRedisKeyPrefix(env);
  const baseKey = `ratelimit:graphql:${shopId}`;

  // Match BullMQ key composition: BullMQ itself appends `:${queueName}` to the prefix.
  // In our envs, prefixes can intentionally end with ':' which results in a double-colon
  // namespace like `neanelu:dev::bulk-queue:*`. Keep the same behavior for custom keys.
  return prefix ? `${prefix}:${baseKey}` : baseKey;
}

export type ShopifyGraphqlRateLimitConfig = Readonly<{
  maxTokens: number;
  refillPerSecond: number;
  ttlMs: number;
  defaultPollCost: number;
  defaultBulkStartCost: number;
}>;

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function getShopifyGraphqlRateLimitConfig(
  env: Record<string, string | undefined> = process.env
): ShopifyGraphqlRateLimitConfig {
  // CONFORM:
  // - Plan_de_implementare.md F4.3 + F5.1.5: distributed rate limiting via Redis + BullMQ delay
  // - Defaults represent conservative "bootstrap" values.
  // - Reactive throttling still handled by shopifyApi client (ShopifyRateLimitedError).
  const maxTokens = parsePositiveInt(env['SHOPIFY_GRAPHQL_MAX_TOKENS']) ?? 1000;
  const refillPerSecond = parsePositiveInt(env['SHOPIFY_GRAPHQL_REFILL_PER_SECOND']) ?? 50;
  const ttlMs = parsePositiveInt(env['SHOPIFY_GRAPHQL_BUCKET_TTL_MS']) ?? 10 * 60 * 1000;

  const defaultPollCost = parsePositiveInt(env['SHOPIFY_GRAPHQL_POLL_COST']) ?? 10;
  const defaultBulkStartCost = parsePositiveInt(env['SHOPIFY_GRAPHQL_BULK_START_COST']) ?? 50;

  return { maxTokens, refillPerSecond, ttlMs, defaultPollCost, defaultBulkStartCost };
}

export async function gateShopifyGraphqlRequest(params: {
  redis: Redis;
  shopId: string;
  costToConsume: number;
  config?: ShopifyGraphqlRateLimitConfig;
}): Promise<void> {
  const cfg = params.config ?? getShopifyGraphqlRateLimitConfig();
  const bucketKey = graphqlBucketKey(params.shopId);

  // If someone configures a smaller bucket capacity than our chosen cost estimate,
  // the token bucket would deny forever. Cap cost to capacity for robustness.
  const rawCost = Math.max(0, Math.floor(params.costToConsume));
  const costToConsume = Math.min(rawCost, cfg.maxTokens);

  const gate = await checkAndConsumeCost(params.redis, {
    bucketKey,
    costToConsume,
    maxTokens: cfg.maxTokens,
    refillPerSecond: cfg.refillPerSecond,
    ttlMs: cfg.ttlMs,
  });

  if (!gate.allowed) {
    throw new ShopifyRateLimitedError({
      kind: 'preflight',
      delayMs: gate.delayMs,
      details: {
        bucketKey,
        costToConsume,
        maxTokens: cfg.maxTokens,
        refillPerSecond: cfg.refillPerSecond,
        ttlMs: cfg.ttlMs,
        tokensRemaining: gate.tokensRemaining,
        tokensNow: gate.tokensNow,
      },
    });
  }
}

export async function syncShopifyGraphqlThrottleStatus(params: {
  redis: Redis;
  shopId: string;
  throttleStatus: ShopifyGraphqlThrottleStatus;
  config?: ShopifyGraphqlRateLimitConfig;
}): Promise<void> {
  const cfg = params.config ?? getShopifyGraphqlRateLimitConfig();
  const bucketKey = graphqlBucketKey(params.shopId);

  const available = Math.max(0, Math.floor(params.throttleStatus.currentlyAvailable));
  const tokens = Math.min(cfg.maxTokens, available);
  const nowMs = Date.now();

  await params.redis.hset(bucketKey, {
    ts: String(nowMs),
    tokens: String(tokens),
  });
  await params.redis.pexpire(bucketKey, cfg.ttlMs);
}
