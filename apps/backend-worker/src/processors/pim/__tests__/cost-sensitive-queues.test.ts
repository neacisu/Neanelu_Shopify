import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

const pausedQueues = new Set<string>();
const pausedEvents: { trigger: string; queueName?: string }[] = [];
const resumedEvents: { trigger: string; queueName?: string }[] = [];

void mock.module('@app/queue-manager', {
  namedExports: {
    COST_SENSITIVE_QUEUE_NAMES: [
      'ai-batch-queue',
      'bulk-ingest-queue',
      'pim-enrichment-queue',
      'pim-similarity-search',
      'pim-ai-audit',
      'pim-extraction',
    ],
    configFromEnv: () => ({}) as never,
    createQueue: (_ctx: unknown, opts: { name: string }) => ({
      isPaused: () => Promise.resolve(pausedQueues.has(opts.name)),
      pause: () => {
        pausedQueues.add(opts.name);
        return Promise.resolve();
      },
      resume: () => {
        pausedQueues.delete(opts.name);
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
    }),
  },
});

void mock.module('../../../otel/metrics.js', {
  namedExports: {
    recordPimQueuePaused: (trigger: string, queueName?: string) => {
      pausedEvents.push(queueName ? { trigger, queueName } : { trigger });
    },
    recordPimQueueResumed: (trigger: string, queueName?: string) => {
      resumedEvents.push(queueName ? { trigger, queueName } : { trigger });
    },
  },
});

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  fatal: () => undefined,
  trace: () => undefined,
};

const { pauseCostSensitiveQueues, resumeCostSensitiveQueues, readCostSensitiveQueueStatus } =
  await import('../cost-sensitive-queues.js');

void describe('cost-sensitive queue controls', () => {
  void it('pauses and resumes all cost-sensitive queues', async () => {
    pausedQueues.clear();
    pausedEvents.length = 0;
    resumedEvents.length = 0;

    const paused = await pauseCostSensitiveQueues({
      config: {} as never,
      trigger: 'manual',
      logger: logger as never,
    });
    assert.equal(paused.length, 6);
    assert.equal(
      paused.every((entry) => entry.paused),
      true
    );
    assert.equal(pausedEvents.length, 6);

    const resumed = await resumeCostSensitiveQueues({
      config: {} as never,
      trigger: 'scheduler',
      logger: logger as never,
    });
    assert.equal(resumed.length, 6);
    assert.equal(
      resumed.every((entry) => !entry.paused),
      true
    );
    assert.equal(resumedEvents.length, 6);
  });

  void it('reads queue status', async () => {
    pausedQueues.clear();
    pausedQueues.add('pim-enrichment-queue');
    const statuses = await readCostSensitiveQueueStatus({} as never);
    assert.equal(statuses.length, 6);
    const enrichment = statuses.find((entry) => entry.queueName === 'pim-enrichment-queue');
    assert.equal(enrichment?.paused, true);
  });
});
