import type { Redis } from 'ioredis';
import type { DashboardJobType } from '@app/types';

const KEY_PREFIX = 'dashboard:activity:v1:';
const KEY_TTL_SECONDS = 60 * 24 * 60 * 60; // ~60 days

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatUtcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = pad2(date.getUTCMonth() + 1);
  const d = pad2(date.getUTCDate());
  return `${y}-${m}-${d}`;
}

export function activityKeyForUtcDate(date: Date): string {
  return `${KEY_PREFIX}${formatUtcDate(date)}`;
}

export async function incrementDashboardActivity(
  redis: Redis,
  jobType: DashboardJobType,
  amount = 1
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;

  const key = activityKeyForUtcDate(new Date());
  const pipeline = redis.pipeline();
  pipeline.hincrby(key, jobType, Math.floor(amount));
  pipeline.hincrby(key, 'total', Math.floor(amount));
  pipeline.expire(key, KEY_TTL_SECONDS);
  await pipeline.exec();
}
