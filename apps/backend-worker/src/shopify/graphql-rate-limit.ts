import { checkAndConsumeCost } from '@app/queue-manager';
import { ShopifyRateLimitedError } from '@app/shopify-client';
import type { Redis } from 'ioredis';

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
  const bucketKey = `neanelu:ratelimit:graphql:${params.shopId}`;

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
