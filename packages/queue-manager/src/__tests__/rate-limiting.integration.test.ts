import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { Redis as IORedis } from 'ioredis';

import { createQueue, createQueueEvents, createWorker } from '../queue-manager.js';
import { checkAndConsumeCost } from '../strategies/fairness/rate-limiter.js';
import { acquireBulkLock, releaseBulkLock, renewBulkLock } from '../locks/bulk-lock.js';

process.env['QUEUE_MANAGER_DLQ_STRICT'] = 'true';

const isCi = process.env['CI'] === 'true' || process.env['GITHUB_ACTIONS'] === 'true';
function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Missing required env var for tests: ${name}`);
  return value;
}

interface TestConfig {
  redisUrl: string;
  bullmqProToken: string;
}

function getTestConfig(): TestConfig {
  return {
    redisUrl: getRequiredEnv('REDIS_URL'),
    bullmqProToken: getRequiredEnv('BULLMQ_PRO_TOKEN'),
  };
}

let testConfig: TestConfig | null = null;
try {
  testConfig = getTestConfig();
} catch (err) {
  if (isCi) throw err;
  testConfig = null;
}

async function isRedisReachable(redisUrl: string): Promise<boolean> {
  const client = new IORedis(redisUrl, {
    lazyConnect: true,
    enableReadyCheck: false,
    connectTimeout: 750,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });

  client.on('error', () => {
    // ignore
  });

  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  } finally {
    try {
      client.disconnect();
    } catch {
      // ignore
    }
  }
}

const redisReachable = testConfig ? await isRedisReachable(testConfig.redisUrl) : false;
if (testConfig && !redisReachable) {
  if (isCi) {
    throw new Error(
      `Redis is not reachable at REDIS_URL=${testConfig.redisUrl}. Integration tests require a running Redis service.`
    );
  }
  testConfig = null;
}

void describe('rate limiting + bulk lock (integration)', { skip: !testConfig }, () => {
  const baseName = `rl-it-${randomUUID()}`;

  before(() => {
    assert.ok(testConfig);
  });

  after(async () => {
    if (!testConfig) return;
    const q = createQueue({ config: testConfig }, { name: `${baseName}-queue` });
    try {
      await q.obliterate({ force: true });
    } finally {
      await q.close();
    }
  });

  void it('Lua token bucket is atomic under concurrency', async () => {
    assert.ok(testConfig);
    const redis = new IORedis(testConfig.redisUrl);

    const bucketKey = `test:bucket:${randomUUID()}`;
    const nowMs = 1_000_000;

    try {
      const results = await Promise.all(
        Array.from({ length: 20 }).map(() =>
          checkAndConsumeCost(redis, {
            bucketKey,
            nowMs,
            costToConsume: 1,
            maxTokens: 10,
            refillPerSecond: 0,
            ttlMs: 60_000,
          })
        )
      );

      const allowedCount = results.filter((r) => r.allowed).length;
      assert.equal(allowedCount, 10);

      for (const r of results) {
        assert.ok(r.tokensRemaining >= 0);
        assert.ok(r.tokensNow >= 0);
      }

      const final = await checkAndConsumeCost(redis, {
        bucketKey,
        nowMs,
        costToConsume: 0,
        maxTokens: 10,
        refillPerSecond: 0,
        ttlMs: 60_000,
      });
      assert.equal(final.tokensRemaining, 0);
    } finally {
      await redis.quit();
    }
  });

  void it(
    'delays a job when processor throws a delayMs-shaped error (no retry storm)',
    { timeout: 10_000 },
    async () => {
      assert.ok(testConfig);
      const cfg = testConfig;

      const name = `${baseName}-queue`;
      const queue = createQueue({ config: cfg }, { name });
      const events = createQueueEvents({ config: cfg }, { name });

      const seen = new Set<string>();

      class DelayMsError extends Error {
        public readonly delayMs: number;
        constructor(delayMs: number) {
          super('delayed');
          Object.setPrototypeOf(this, DelayMsError.prototype);
          this.name = 'ShopifyRateLimitedError';
          this.delayMs = delayMs;
        }
      }

      const { worker } = createWorker<{ id: string }>(
        { config: cfg },
        {
          name,
          enableDelayHandling: true,
          processor: (job) => {
            const id = String(job.id);
            if (!seen.has(id)) {
              seen.add(id);
              throw new DelayMsError(250);
            }

            return Promise.resolve();
          },
        }
      );

      try {
        const completed = new Promise<void>((resolve) => {
          events.once('completed', () => resolve());
        });

        await queue.add('rate-limited', { id: randomUUID() });
        await completed;

        assert.equal(seen.size, 1);
      } finally {
        await worker.close();
        await events.close();
        await queue.close();
      }
    }
  );

  void it('bulk lock enforces 1 active per shop without cross-shop blocking', async () => {
    assert.ok(testConfig);
    const redis = new IORedis(testConfig.redisUrl);

    // Canonical UUIDs required by normalizeShopIdToGroupId.
    const shopA = '00000000-0000-0000-0000-000000000001';
    const shopB = '00000000-0000-0000-0000-000000000002';

    try {
      const a1 = await acquireBulkLock(redis, shopA, { ttlMs: 5_000 });
      assert.ok(a1);

      const a2 = await acquireBulkLock(redis, shopA, { ttlMs: 5_000 });
      assert.equal(a2, null);

      const b1 = await acquireBulkLock(redis, shopB, { ttlMs: 5_000 });
      assert.ok(b1);

      assert.equal(await renewBulkLock(redis, a1, 5_000), true);

      assert.equal(await releaseBulkLock(redis, a1), true);

      const a3 = await acquireBulkLock(redis, shopA, { ttlMs: 5_000 });
      assert.ok(a3);

      await releaseBulkLock(redis, a3);
      await releaseBulkLock(redis, b1);
    } finally {
      await redis.quit();
    }
  });
});
