import type { Redis } from 'ioredis';
import { readFileSync } from 'node:fs';

export type RateLimiterParams = Readonly<{
  bucketKey: string;
  nowMs?: number;
  costToConsume: number;
  maxTokens: number;
  refillPerSecond: number;
  /** Expire idle buckets (ms). Default: 10 minutes. */
  ttlMs?: number;
}>;

export type RateLimiterResult = Readonly<{
  allowed: boolean;
  delayMs: number;
  tokensRemaining: number;
  tokensNow: number;
}>;

const DEFAULT_TTL_MS = 10 * 60 * 1000;

const scriptUrl = new URL('./rate-limiter.lua', import.meta.url);
const scriptSource = readFileSync(scriptUrl, 'utf8');

const shaByRedis = new WeakMap<Redis, string>();

async function evalRateLimiter(
  redis: Redis,
  args: {
    bucketKey: string;
    nowMs: number;
    costToConsume: number;
    maxTokens: number;
    refillPerSecond: number;
    ttlMs: number;
  }
): Promise<[number, number, number, number]> {
  const existingSha = shaByRedis.get(redis);

  const keysCount = 1;
  const argv = [
    String(args.nowMs),
    String(args.costToConsume),
    String(args.maxTokens),
    String(args.refillPerSecond),
    String(args.ttlMs),
  ];

  if (existingSha) {
    try {
      const raw = await redis.evalsha(existingSha, keysCount, args.bucketKey, ...argv);
      if (!Array.isArray(raw) || raw.length < 4) throw new Error('rate_limiter_invalid_lua_result');
      return [Number(raw[0]), Number(raw[1]), Number(raw[2]), Number(raw[3])];
    } catch (err) {
      // NOSCRIPT => fall through to load.
      const message = err instanceof Error ? err.message : '';
      if (!message.includes('NOSCRIPT')) throw err;
    }
  }

  const loaded = await redis.script('LOAD', scriptSource);
  if (typeof loaded !== 'string') throw new Error('rate_limiter_invalid_script_sha');
  const sha = loaded;
  shaByRedis.set(redis, sha);

  const raw = await redis.evalsha(sha, keysCount, args.bucketKey, ...argv);
  if (!Array.isArray(raw) || raw.length < 4) throw new Error('rate_limiter_invalid_lua_result');
  return [Number(raw[0]), Number(raw[1]), Number(raw[2]), Number(raw[3])];
}

export async function checkAndConsumeCost(
  redis: Redis,
  params: RateLimiterParams
): Promise<RateLimiterResult> {
  const nowMs = params.nowMs ?? Date.now();
  const ttlMs = params.ttlMs ?? DEFAULT_TTL_MS;

  const bucketKey = params.bucketKey.trim();
  if (!bucketKey) throw new Error('rate_limiter_bucket_key_empty');

  const costToConsume = Math.max(0, Math.floor(params.costToConsume));
  const maxTokens = Math.max(0, Math.floor(params.maxTokens));
  const refillPerSecond = Number(params.refillPerSecond);

  const [allowed, delayMs, tokensRemaining, tokensNow] = await evalRateLimiter(redis, {
    bucketKey,
    nowMs,
    costToConsume,
    maxTokens,
    refillPerSecond,
    ttlMs,
  });

  return {
    allowed: allowed === 1,
    delayMs: Math.max(0, Number(delayMs) || 0),
    tokensRemaining: Math.max(0, Number(tokensRemaining) || 0),
    tokensNow: Math.max(0, Number(tokensNow) || 0),
  };
}
