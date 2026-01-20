import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Redis as IORedis } from 'ioredis';

import { acquireBulkLock, releaseBulkLock, renewBulkLock } from '@app/queue-manager';

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRedisReady(): boolean {
  return Boolean(process.env['REDIS_URL']);
}

void describe('chaos: concurrent bulk lock', { skip: !isRedisReady() }, () => {
  void it('allows only one active lock per shop', async (t) => {
    if (!isRedisReady()) {
      t.skip('Requires REDIS_URL');
      return;
    }

    const redis = new IORedis(process.env['REDIS_URL'] ?? '');
    const shopId = '00000000-0000-0000-0000-000000000123';

    try {
      const first = await acquireBulkLock(redis, shopId, { ttlMs: 5_000 });
      const second = await acquireBulkLock(redis, shopId, { ttlMs: 5_000 });

      assert.ok(first, 'first lock should be acquired');
      assert.equal(second, null, 'second lock should be blocked');

      if (first) {
        await releaseBulkLock(redis, first);
      }
    } finally {
      await redis.quit();
    }
  });

  void it('renews TTL and recovers stale lock', async (t) => {
    if (!isRedisReady()) {
      t.skip('Requires REDIS_URL');
      return;
    }

    const redis = new IORedis(process.env['REDIS_URL'] ?? '');
    const shopId = '00000000-0000-0000-0000-000000000124';
    const ttlMs = 200;

    const handle = await acquireBulkLock(redis, shopId, { ttlMs });
    assert.ok(handle, 'lock should be acquired');

    try {
      await sleep(120);
      assert.equal(await renewBulkLock(redis, handle, ttlMs), true, 'renew should succeed');

      await sleep(120);
      const blocked = await acquireBulkLock(redis, shopId, { ttlMs });
      assert.equal(blocked, null, 'lock should still be held after renewal');

      await sleep(240);
      const recovered = await acquireBulkLock(redis, shopId, { ttlMs });
      assert.ok(recovered, 'stale lock should expire and be acquired');
      if (recovered) await releaseBulkLock(redis, recovered);
    } finally {
      if (handle) await releaseBulkLock(redis, handle).catch(() => undefined);
      await redis.quit();
    }
  });
});
