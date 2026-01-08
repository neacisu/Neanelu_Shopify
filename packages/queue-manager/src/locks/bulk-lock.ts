import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { metrics } from '@opentelemetry/api';

import { normalizeShopIdToGroupId } from '../strategies/fairness/group-id.js';

// F4.4.4: Bulk lock metrics
const meter = metrics.getMeter('neanelu-shopify.bulk-lock');
const bulkLockAcquireTotal = meter.createCounter('bulk_lock_acquire_total', {
  description: 'Successful bulk lock acquisitions',
});
const bulkLockContentionTotal = meter.createCounter('bulk_lock_contention_total', {
  description: 'Bulk lock acquisition failures due to contention',
});
const bulkLockReleaseTotal = meter.createCounter('bulk_lock_release_total', {
  description: 'Bulk lock releases',
});

export type BulkLockOptions = Readonly<{
  ttlMs: number;
}>;

export type BulkLockHandle = Readonly<{
  shopId: string;
  token: string;
}>;

const scriptUrl = new URL('./bulk-lock.lua', import.meta.url);
const scriptSource = readFileSync(scriptUrl, 'utf8');

const shaByRedis = new WeakMap<Redis, string>();

async function evalBulkLock(
  redis: Redis,
  args: { lockKey: string; op: 'acquire' | 'renew' | 'release'; token: string; ttlMs?: number }
): Promise<number> {
  const keysCount = 1;
  const argv = [args.op, args.token, String(args.ttlMs ?? 0)];

  const existingSha = shaByRedis.get(redis);
  if (existingSha) {
    try {
      const result = await redis.evalsha(existingSha, keysCount, args.lockKey, ...argv);
      return Number(result) === 1 ? 1 : 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (!message.includes('NOSCRIPT')) throw err;
    }
  }

  const loaded = await redis.script('LOAD', scriptSource);
  if (typeof loaded !== 'string') throw new Error('bulk_lock_invalid_script_sha');
  const sha = loaded;
  shaByRedis.set(redis, sha);
  const result = await redis.evalsha(sha, keysCount, args.lockKey, ...argv);
  return Number(result) === 1 ? 1 : 0;
}

function lockKeyForShop(shopId: string): string {
  const groupId = normalizeShopIdToGroupId(shopId);
  if (!groupId) throw new Error('bulk_lock_invalid_shop_id');
  return `bulk-lock:${groupId}`;
}

export async function acquireBulkLock(
  redis: Redis,
  shopId: string,
  options: BulkLockOptions
): Promise<BulkLockHandle | null> {
  const ttlMs = Math.max(1, Math.floor(options.ttlMs));
  const lockKey = lockKeyForShop(shopId);

  const token = randomUUID();
  const ok = await evalBulkLock(redis, { lockKey, op: 'acquire', token, ttlMs });

  // F4.4.4: Emit metrics
  if (ok === 1) {
    bulkLockAcquireTotal.add(1);
    return { shopId: shopId.trim().toLowerCase(), token };
  }
  bulkLockContentionTotal.add(1);
  return null;
}

export async function renewBulkLock(
  redis: Redis,
  handle: BulkLockHandle,
  ttlMs: number
): Promise<boolean> {
  const lockKey = lockKeyForShop(handle.shopId);
  const ok = await evalBulkLock(redis, { lockKey, op: 'renew', token: handle.token, ttlMs });
  return ok === 1;
}

export async function releaseBulkLock(redis: Redis, handle: BulkLockHandle): Promise<boolean> {
  const lockKey = lockKeyForShop(handle.shopId);
  const ok = await evalBulkLock(redis, { lockKey, op: 'release', token: handle.token });

  // F4.4.4: Emit metrics
  if (ok === 1) {
    bulkLockReleaseTotal.add(1);
  }
  return ok === 1;
}

export function startBulkLockRenewal(
  redis: Redis,
  handle: BulkLockHandle,
  options: { ttlMs: number; refreshIntervalMs: number }
): { stop: () => void } {
  const refreshIntervalMs = Math.max(250, Math.floor(options.refreshIntervalMs));
  const ttlMs = Math.max(1, Math.floor(options.ttlMs));

  const timer = setInterval(() => {
    void renewBulkLock(redis, handle, ttlMs);
  }, refreshIntervalMs);

  // Allow process to exit.
  timer.unref();

  return {
    stop: () => clearInterval(timer),
  };
}
