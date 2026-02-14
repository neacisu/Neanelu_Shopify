import type { Redis } from 'ioredis';

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
}

export async function waitForRateLimit(
  url: string,
  redis: Redis,
  defaultRps: number
): Promise<number> {
  const domain = getDomain(url);
  const key = `scraper:ratelimit:${domain}`;
  const rps = Math.max(1, Math.floor(defaultRps));
  const windowMs = 1000;
  const now = Date.now();
  const minScore = now - windowMs;

  await redis.zremrangebyscore(key, '-inf', minScore);
  const currentCount = await redis.zcard(key);

  if (currentCount >= rps) {
    const earliest = await redis.zrange(key, 0, 0, 'WITHSCORES');
    const score = Number(earliest[1] ?? now);
    const waitMs = Math.max(50, score + windowMs - now);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    await redis.zremrangebyscore(key, '-inf', Date.now() - windowMs);
    await redis
      .multi()
      .zadd(key, String(Date.now()), `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
      .pexpire(key, windowMs * 2)
      .exec();
    return waitMs;
  }

  await redis
    .multi()
    .zadd(key, String(Date.now()), `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    .pexpire(key, windowMs * 2)
    .exec();
  return 0;
}
