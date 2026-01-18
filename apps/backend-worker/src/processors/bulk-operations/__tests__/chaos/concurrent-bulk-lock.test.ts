import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Redis as IORedis } from 'ioredis';

import { acquireBulkLock, releaseBulkLock } from '@app/queue-manager';

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
});
