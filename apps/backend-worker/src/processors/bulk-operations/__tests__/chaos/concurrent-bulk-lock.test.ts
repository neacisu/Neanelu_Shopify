import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Redis as IORedis } from 'ioredis';

import { acquireBulkLock, releaseBulkLock, renewBulkLock } from '@app/queue-manager';

function logStep(message: string): void {
  console.info(`[bulk-lock] ${new Date().toISOString()} ${message}`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRedisReady(): boolean {
  return Boolean(process.env['RUN_INTEGRATION_TESTS'] === '1' && process.env['REDIS_URL']);
}

void describe('chaos: concurrent bulk lock', { skip: !isRedisReady() }, () => {
  void it('allows only one active lock per shop', async (t) => {
    if (!isRedisReady()) {
      t.skip('Requires RUN_INTEGRATION_TESTS=1 and REDIS_URL');
      return;
    }

    logStep('test:single-lock:start');
    const redis = new IORedis(process.env['REDIS_URL'] ?? '');
    const shopId = '00000000-0000-0000-0000-000000000123';

    try {
      logStep('lock:acquire:first:start');
      const first = await acquireBulkLock(redis, shopId, { ttlMs: 5_000 });
      logStep('lock:acquire:first:done');
      logStep('lock:acquire:second:start');
      const second = await acquireBulkLock(redis, shopId, { ttlMs: 5_000 });
      logStep('lock:acquire:second:done');

      assert.ok(first, 'first lock should be acquired');
      assert.equal(second, null, 'second lock should be blocked');

      if (first) {
        logStep('lock:release:first:start');
        await releaseBulkLock(redis, first);
        logStep('lock:release:first:done');
      }
    } finally {
      logStep('redis:quit');
      await redis.quit();
    }
    logStep('test:single-lock:done');
  });

  void it('renews TTL and recovers stale lock', async (t) => {
    if (!isRedisReady()) {
      t.skip('Requires RUN_INTEGRATION_TESTS=1 and REDIS_URL');
      return;
    }

    logStep('test:renewal:start');
    const redis = new IORedis(process.env['REDIS_URL'] ?? '');
    const shopId = '00000000-0000-0000-0000-000000000124';
    const ttlMs = 200;

    logStep('lock:acquire:handle:start');
    const handle = await acquireBulkLock(redis, shopId, { ttlMs });
    logStep('lock:acquire:handle:done');
    assert.ok(handle, 'lock should be acquired');

    try {
      logStep('sleep:120');
      await sleep(120);
      logStep('lock:renew:start');
      assert.equal(await renewBulkLock(redis, handle, ttlMs), true, 'renew should succeed');
      logStep('lock:renew:done');

      logStep('sleep:120');
      await sleep(120);
      logStep('lock:acquire:blocked:start');
      const blocked = await acquireBulkLock(redis, shopId, { ttlMs });
      logStep('lock:acquire:blocked:done');
      assert.equal(blocked, null, 'lock should still be held after renewal');

      logStep('sleep:240');
      await sleep(240);
      logStep('lock:acquire:recovered:start');
      const recovered = await acquireBulkLock(redis, shopId, { ttlMs });
      logStep('lock:acquire:recovered:done');
      assert.ok(recovered, 'stale lock should expire and be acquired');
      if (recovered) {
        logStep('lock:release:recovered:start');
        await releaseBulkLock(redis, recovered);
        logStep('lock:release:recovered:done');
      }
    } finally {
      if (handle) {
        logStep('lock:release:handle:start');
        await releaseBulkLock(redis, handle).catch(() => undefined);
        logStep('lock:release:handle:done');
      }
      logStep('redis:quit');
      await redis.quit();
    }
    logStep('test:renewal:done');
  });
});
