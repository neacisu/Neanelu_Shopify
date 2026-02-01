import { loadEnv } from '@app/config';
import { createRedisConnection } from '@app/queue-manager';

type ThrottleResult = Readonly<{
  allowed: boolean;
  delayMs: number;
  reason?: string;
}>;

const SHOP_HOURLY_LIMIT_DEFAULT = 1000;
const GLOBAL_HOURLY_LIMIT_DEFAULT = 10000;

let cachedRedis: ReturnType<typeof createRedisConnection> | null = null;

function getRedis() {
  if (cachedRedis) return cachedRedis;
  const env = loadEnv();
  cachedRedis = createRedisConnection({ redisUrl: env.redisUrl });
  return cachedRedis;
}

function formatKeyDate(date: Date): { dayKey: string; hourKey: string } {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  return {
    dayKey: `${year}${month}${day}`,
    hourKey: `${year}${month}${day}${hour}`,
  };
}

function msUntilNextHour(date: Date): number {
  const next = new Date(date);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return Math.max(1000, next.getTime() - date.getTime());
}

function msUntilNextDay(date: Date): number {
  const next = new Date(date);
  next.setUTCHours(0, 5, 0, 0);
  next.setUTCDate(next.getUTCDate() + 1);
  return Math.max(1000, next.getTime() - date.getTime());
}

export async function checkBackfillThrottle(params: {
  shopId: string;
  requestedItems: number;
  maxItemsPerShopPerHour?: number;
  maxItemsGlobalPerHour?: number;
  maxItemsPerDay?: number;
}): Promise<ThrottleResult> {
  const env = loadEnv();
  const now = new Date();
  const { dayKey, hourKey } = formatKeyDate(now);
  const redis = getRedis();

  const maxItemsPerShopPerHour =
    params.maxItemsPerShopPerHour ??
    env.openAiEmbedThrottleShopHourlyLimit ??
    SHOP_HOURLY_LIMIT_DEFAULT;
  const maxItemsGlobalPerHour =
    params.maxItemsGlobalPerHour ??
    env.openAiEmbedThrottleGlobalHourlyLimit ??
    GLOBAL_HOURLY_LIMIT_DEFAULT;
  const maxItemsPerDay = params.maxItemsPerDay ?? env.openAiEmbeddingDailyBudget;

  const shopHourKey = `embedding:backfill:shop:${params.shopId}:hour:${hourKey}`;
  const globalHourKey = `embedding:backfill:global:hour:${hourKey}`;
  const globalDayKey = `embedding:backfill:global:day:${dayKey}`;

  const [shopHourRaw, globalHourRaw, globalDayRaw] = await redis.mget(
    shopHourKey,
    globalHourKey,
    globalDayKey
  );

  const shopHour = Number(shopHourRaw ?? 0);
  const globalHour = Number(globalHourRaw ?? 0);
  const globalDay = Number(globalDayRaw ?? 0);

  if (shopHour + params.requestedItems > maxItemsPerShopPerHour) {
    return { allowed: false, delayMs: msUntilNextHour(now), reason: 'shop_hourly_limit' };
  }

  if (globalHour + params.requestedItems > maxItemsGlobalPerHour) {
    return { allowed: false, delayMs: msUntilNextHour(now), reason: 'global_hourly_limit' };
  }

  if (globalDay + params.requestedItems > maxItemsPerDay) {
    return { allowed: false, delayMs: msUntilNextDay(now), reason: 'global_daily_limit' };
  }

  const multi = redis.multi();
  multi.incrby(shopHourKey, params.requestedItems);
  multi.expire(shopHourKey, 3 * 3600);
  multi.incrby(globalHourKey, params.requestedItems);
  multi.expire(globalHourKey, 3 * 3600);
  multi.incrby(globalDayKey, params.requestedItems);
  multi.expire(globalDayKey, 3 * 86400);
  await multi.exec();

  return { allowed: true, delayMs: 0 };
}
