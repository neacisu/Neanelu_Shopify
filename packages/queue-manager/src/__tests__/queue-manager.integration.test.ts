import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { Redis as IORedis } from 'ioredis';
import { createQueue, createQueueEvents, createWorker, pruneQueue } from '../queue-manager.js';

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
      cleanupQueue(`${baseName}-prune`),
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
});
