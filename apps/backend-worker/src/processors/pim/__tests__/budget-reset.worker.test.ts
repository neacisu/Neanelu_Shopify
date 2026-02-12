import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

const state = { paused: true, resumed: false };

void mock.module('@app/queue-manager', {
  namedExports: {
    ENRICHMENT_QUEUE_NAME: 'pim-enrichment-queue',
    configFromEnv: () => ({}) as never,
    createQueue: () => ({
      isPaused: () => Promise.resolve(state.paused),
      resume: () => {
        state.resumed = true;
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
    }),
    createWorker: () => ({
      worker: {
        close: () => Promise.resolve(),
      },
    }),
    withJobTelemetryContext: async (_job: unknown, fn: () => Promise<unknown>) => await fn(),
  },
});

void mock.module('../../../otel/metrics.js', {
  namedExports: {
    recordPimQueuePaused: () => undefined,
  },
});

const { runBudgetResetTick } = await import('../budget-reset.worker.js');

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  fatal: () => undefined,
  trace: () => undefined,
};

void describe('budget-reset worker', () => {
  void it('resumes enrichment queue when paused', async () => {
    state.paused = true;
    state.resumed = false;

    const resumed = await runBudgetResetTick({ config: {} as never, logger: logger as never });
    assert.equal(resumed, true);
    assert.equal(state.resumed, true);
  });
});
