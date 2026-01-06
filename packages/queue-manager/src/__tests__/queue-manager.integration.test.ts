import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { Redis as IORedis } from 'ioredis';
import { createQueue, createQueueEvents, createWorker, pruneQueue } from '../queue-manager.js';

process.env['QUEUE_MANAGER_DLQ_STRICT'] = 'true';
process.env['STARVATION_TIMEOUT_MS'] ??= '3000';

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
  // Keep this aligned with packages/config loadEnv requirements:
  // queue-manager uses only REDIS_URL + BULLMQ_PRO_TOKEN.
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

  // Avoid noisy "Unhandled error event" logs during preflight.
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

  // Local dev: don't hang the whole workspace test run if Redis isn't started.
  testConfig = null;
}

async function cleanupQueue(queueName: string): Promise<void> {
  const q = createQueue({ config: getTestConfig() }, { name: queueName });
  try {
    await q.obliterate({ force: true });
  } finally {
    await q.close();
  }
}

void describe('queue-manager (integration)', { skip: !testConfig }, () => {
  const baseName = `qm-it-${randomUUID()}`;

  before(() => {
    // If we got here, tests are enabled; ensure config is present.
    assert.ok(testConfig);
  });

  after(async () => {
    // Best-effort cleanup (ignore errors).
    await Promise.allSettled([
      cleanupQueue(`${baseName}-e2e`),
      cleanupQueue(`${baseName}-retry`),
      cleanupQueue(`${baseName}-retry-dlq`),
      cleanupQueue(`${baseName}-policy`),
      cleanupQueue(`${baseName}-delayed`),
      cleanupQueue(`${baseName}-retries`),
      cleanupQueue(`${baseName}-retries-dlq`),
      cleanupQueue(`${baseName}-prune`),
      cleanupQueue(`${baseName}-groups-fairness`),
    ]);
  });

  void it('processes a job end-to-end (queue + worker)', async () => {
    const name = `${baseName}-e2e`;
    assert.ok(testConfig);
    const cfg = testConfig;

    const queue = createQueue({ config: cfg }, { name });
    const events = createQueueEvents({ config: cfg }, { name });

    const processed: { id: string; value: number }[] = [];

    const { worker } = createWorker<{ id: string; value: number }>(
      { config: cfg },
      {
        name,
        processor: async (job) => {
          processed.push(job.data);
          await Promise.resolve();
        },
      }
    );

    try {
      const completed = new Promise<void>((resolve) => {
        events.once('completed', () => resolve());
      });

      await queue.add('test', { id: randomUUID(), value: 42 });
      await completed;

      assert.equal(processed.length, 1);
      assert.equal(processed[0]?.value, 42);
    } finally {
      await worker.close();
      await events.close();
      await queue.close();
    }
  });

  void it('applies default policy options to enqueued jobs', async () => {
    const name = `${baseName}-policy`;
    assert.ok(testConfig);
    const cfg = testConfig;

    const queue = createQueue({ config: cfg }, { name });
    try {
      const job = await queue.add('policy', { marker: 'x' });
      const stored = await queue.getJob(job.id!);
      assert.ok(stored);

      // Policy defaults (see policy.ts)
      assert.equal(stored.opts.attempts, 3);
      assert.deepEqual(stored.opts.removeOnComplete, { age: 86400 });
      assert.deepEqual(stored.opts.removeOnFail, { age: 604800 });
      assert.deepEqual(stored.opts.backoff, { type: 'neanelu-exp4', delay: 1000 });
    } finally {
      await queue.close();
    }
  });

  void it('processes a delayed job (no scheduler required)', { timeout: 10_000 }, async () => {
    const name = `${baseName}-delayed`;
    assert.ok(testConfig);
    const cfg = testConfig;

    const queue = createQueue({ config: cfg }, { name });
    const events = createQueueEvents({ config: cfg }, { name });

    const processed: string[] = [];
    const { worker } = createWorker<{ id: string }>(
      { config: cfg },
      {
        name,
        processor: async (job) => {
          processed.push(job.data.id);
          await Promise.resolve();
        },
      }
    );

    try {
      const completed = new Promise<void>((resolve) => {
        events.once('completed', () => resolve());
      });

      const id = randomUUID();
      await queue.add('delayed', { id }, { delay: 150 });
      await completed;

      assert.deepEqual(processed, [id]);
    } finally {
      await worker.close();
      await events.close();
      await queue.close();
    }
  });

  void it('moves a terminally failed job to DLQ', { timeout: 10_000 }, async () => {
    const name = `${baseName}-retry`;
    assert.ok(testConfig);
    const cfg = testConfig;

    const queue = createQueue({ config: cfg }, { name });
    const events = createQueueEvents({ config: cfg }, { name });

    const failedAttemptsMade: number[] = [];

    const { worker, dlqQueue: createdDlqQueue } = createWorker<{ marker: string }>(
      { config: cfg },
      {
        name,
        enableDlq: true,
        processor: async () => {
          await Promise.resolve();
          throw new Error('boom');
        },
      }
    );

    try {
      // Sanity: ensure DLQ queue exists (created by the worker factory).
      assert.ok(createdDlqQueue);

      worker.on('failed', (job) => {
        if (!job) return;
        failedAttemptsMade.push(job.attemptsMade);
      });

      const job = await queue.add(
        'always-fails',
        { marker: 'x' },
        {
          // Keep this integration test fast and deterministic.
          // (attempts=3 policy is validated by unit tests)
          attempts: 1,
        }
      );

      // Wait for the job to reach its terminal failed state.
      await Promise.race([
        (async () => {
          // Polling avoids relying on QueueEvents semantics across BullMQ variants.
          while (true) {
            const existing = await queue.getJob(job.id!);
            if (!existing) return;

            const state = await queue.getJobState(job.id!);
            if (state === 'failed') return;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        })(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('job_failed_timeout')), 8_000)
        ),
      ]);

      // Give the DLQ writer a tiny window to enqueue.
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The DLQ entry is *enqueued* (not completed) because there's no DLQ worker.
      const counts = await createdDlqQueue.getJobCounts();
      const enqueued =
        (counts['waiting'] ?? 0) + (counts['delayed'] ?? 0) + (counts['paused'] ?? 0);
      assert.ok(
        enqueued >= 1,
        `Expected DLQ to have >=1 enqueued job; counts=${JSON.stringify(counts)} failedAttemptsMade=${JSON.stringify(
          failedAttemptsMade
        )}`
      );
    } finally {
      await worker.close();
      await events.close();
      await createdDlqQueue?.close();
      await queue.close();
    }
  });

  void it('retries and then moves to DLQ on exhausted attempts', { timeout: 15_000 }, async () => {
    const name = `${baseName}-retries`;
    assert.ok(testConfig);
    const cfg = testConfig;

    const queue = createQueue({ config: cfg }, { name });
    const { worker, dlqQueue: createdDlqQueue } = createWorker<{ marker: string }>(
      { config: cfg },
      {
        name,
        enableDlq: true,
        processor: async () => {
          await Promise.resolve();
          throw new Error('boom');
        },
      }
    );

    try {
      assert.ok(createdDlqQueue);

      const attemptsMade: number[] = [];
      const exhausted = new Promise<void>((resolve) => {
        worker.on('failed', (job) => {
          if (!job) return;
          attemptsMade.push(job.attemptsMade);
          if (job.attemptsMade >= 3) resolve();
        });
      });

      await queue.add(
        'always-fails',
        { marker: 'x' },
        {
          attempts: 3,
          // Keep this integration test fast; we validate the exp4 schedule in unit tests.
          backoff: { type: 'fixed', delay: 1 },
        }
      );

      // Wait for retries to be exhausted (observed via worker 'failed' events), and for DLQ enqueue.
      const dlqEnqueued = (async () => {
        while (true) {
          const counts = await createdDlqQueue.getJobCounts();
          const enqueued =
            (counts['waiting'] ?? 0) + (counts['delayed'] ?? 0) + (counts['paused'] ?? 0);
          if (enqueued >= 1) return counts;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      })();

      const counts = await Promise.race([
        (async () => {
          await exhausted;
          return dlqEnqueued;
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('job_failed_timeout')), 12_000)
        ),
      ]);

      const enqueued =
        (counts['waiting'] ?? 0) + (counts['delayed'] ?? 0) + (counts['paused'] ?? 0);
      assert.ok(
        enqueued >= 1,
        `Expected DLQ to have >=1 enqueued job; counts=${JSON.stringify(counts)} attemptsMade=${JSON.stringify(
          attemptsMade
        )}`
      );

      // Should have seen multiple failed events due to retries.
      assert.ok(
        attemptsMade.length >= 2,
        `Expected retries; attemptsMade=${attemptsMade.join(',')}`
      );
      assert.ok(Math.max(...attemptsMade) >= 2);
      assert.ok(Math.max(...attemptsMade) >= 3);
    } finally {
      await worker.close();
      await createdDlqQueue?.close();
      await queue.close();
    }
  });

  void it('prunes completed/failed/delayed jobs', { timeout: 15_000 }, async () => {
    const name = `${baseName}-prune`;
    assert.ok(testConfig);
    const cfg = testConfig;

    const queue = createQueue(
      { config: cfg },
      {
        name,
        defaultJobOptions: {
          removeOnComplete: false,
          removeOnFail: false,
        },
      }
    );

    const { worker } = createWorker<{ shouldFail?: boolean }>(
      { config: cfg },
      {
        name,
        processor: (job) => {
          if (job.data?.shouldFail) return Promise.reject(new Error('boom'));
          return Promise.resolve();
        },
        workerOptions: {
          concurrency: 1,
        },
      }
    );

    try {
      const okJob = await queue.add('ok', { shouldFail: false });
      const failJob = await queue.add('fail', { shouldFail: true }, { attempts: 1 });
      await queue.add('delayed', { shouldFail: false }, { delay: 60_000 });

      await Promise.race([
        (async () => {
          while (true) {
            const okState = await queue.getJobState(okJob.id!);
            const failState = await queue.getJobState(failJob.id!);

            if (okState === 'completed' && failState === 'failed') return;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        })(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('job_state_timeout')), 10_000)
        ),
      ]);

      const before = await queue.getJobCounts();
      assert.ok(
        (before['completed'] ?? 0) >= 1,
        `expected >=1 completed before prune; counts=${JSON.stringify(before)}`
      );
      assert.ok(
        (before['failed'] ?? 0) >= 1,
        `expected >=1 failed before prune; counts=${JSON.stringify(before)}`
      );
      assert.ok(
        (before['delayed'] ?? 0) >= 1,
        `expected >=1 delayed before prune; counts=${JSON.stringify(before)}`
      );

      await pruneQueue(queue, { olderThanMs: 0, limit: 1000 });

      const afterCounts = await queue.getJobCounts();
      assert.equal(afterCounts['completed'] ?? 0, 0);
      assert.equal(afterCounts['failed'] ?? 0, 0);
      assert.equal(afterCounts['delayed'] ?? 0, 0);
    } finally {
      await worker.close();
      await queue.close();
    }
  });

  void it(
    'enforces per-group concurrency and avoids tenant starvation',
    { timeout: 20_000 },
    async () => {
      const name = `${baseName}-groups-fairness`;
      assert.ok(testConfig);
      const cfg = testConfig;

      const queue = createQueue({ config: cfg }, { name });

      const starvationTimeoutMs = Number(process.env['STARVATION_TIMEOUT_MS'] ?? '3000');
      assert.ok(
        Number.isInteger(starvationTimeoutMs) && starvationTimeoutMs > 0,
        `STARVATION_TIMEOUT_MS must be a positive integer, got ${process.env['STARVATION_TIMEOUT_MS']}`
      );

      // Global concurrency=2, per-group concurrency=1.
      // This should allow group B to make progress even if group A has a backlog.
      const activeByGroup = new Map<string, number>();
      const completed: { groupId: string; completedAtMs: number }[] = [];

      const { worker } = createWorker<{ groupId: 'A' | 'B'; seq: number }>(
        { config: cfg },
        {
          name,
          processor: async (job) => {
            const groupId = job.data.groupId;
            const currentActive = activeByGroup.get(groupId) ?? 0;
            activeByGroup.set(groupId, currentActive + 1);

            // groupConcurrency=1 should prevent this ever being >1.
            assert.ok(
              (activeByGroup.get(groupId) ?? 0) <= 1,
              `groupConcurrency violated for group ${groupId}`
            );

            await new Promise((resolve) => setTimeout(resolve, 75));
            completed.push({ groupId, completedAtMs: Date.now() });

            activeByGroup.set(groupId, (activeByGroup.get(groupId) ?? 1) - 1);
          },
          workerOptions: {
            concurrency: 2,
            group: {
              concurrency: 1,
            },
          },
        }
      );

      try {
        // Enqueue a backlog for tenant A.
        for (let i = 0; i < 100; i += 1) {
          await queue.add('work', { groupId: 'A', seq: i }, { group: { id: 'A' } });
        }

        // Enqueue a smaller backlog for tenant B.
        // With Groups fairness + concurrency=2, tenant B should not wait for all A jobs.
        const bEnqueuedAtMs = Date.now();
        for (let i = 0; i < 10; i += 1) {
          await queue.add('work', { groupId: 'B', seq: i }, { group: { id: 'B' } });
        }

        // Wait until B completes, or fail fast.
        await Promise.race([
          (async () => {
            while (true) {
              const hasB = completed.some((c) => c.groupId === 'B');
              if (hasB) return;
              await new Promise((resolve) => setTimeout(resolve, 25));
            }
          })(),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('tenant_B_starved_timeout')), starvationTimeoutMs)
          ),
        ]);

        const bCompletedAtMs = completed.find((c) => c.groupId === 'B')!.completedAtMs;
        assert.ok(
          bCompletedAtMs - bEnqueuedAtMs < starvationTimeoutMs,
          `Expected tenant B to complete within STARVATION_TIMEOUT_MS; latencyMs=${bCompletedAtMs - bEnqueuedAtMs}`
        );

        // Stronger signal: some of tenant B's jobs should complete before tenant A drains.
        // This is a lightweight interleaving check without relying on exact ordering.
        const firstTenCompletions = completed.slice(0, 10);
        assert.ok(
          firstTenCompletions.some((c) => c.groupId === 'B'),
          'Expected tenant B to appear in early completions (interleaving)'
        );
      } finally {
        await worker.close();
        await queue.close();
      }
    }
  );
});
