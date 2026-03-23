/* node:test + experimental module mocks: top-level await after mock.module, and describe/test handles. */
/* eslint-disable @typescript-eslint/no-floating-promises */

import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppEnv } from '@app/config';
import type { DlqEntry } from '@app/queue-manager';

const jobRunsPath = new URL('../../processors/lex/job-runs.js', import.meta.url).href;

interface MockDlqJob {
  id: string;
  timestamp: number;
  data: unknown;
  remove: () => Promise<void>;
}

/** state → jobs returned by getJobs([state], …) */
let dlqJobsByState: Record<string, MockDlqJob[]> = {};
const addCalls: { name: string; data: unknown; opts: unknown }[] = [];
let createLexJobRunRecordCalls = 0;
let mainQueueCloseCalls = 0;
let dlqQueueCloseCalls = 0;
let mainAddShouldThrow = false;

function baseDlqEntry(overrides: Partial<DlqEntry> = {}): DlqEntry {
  return {
    originalQueue: 'lex.extract.fragments',
    originalJobId: 'orig-1',
    originalJobName: 'lex.shard.process',
    attemptsMade: 1,
    failedReason: 'x',
    stacktrace: [],
    data: { shopId: 'shop-a.myshopify.com', shardId: 's1' },
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

mock.module('@app/config', {
  namedExports: {
    loadEnv: (): AppEnv => ({}) as AppEnv,
  },
});

mock.module('@app/queue-manager', {
  namedExports: {
    configFromEnv: () => ({ bullmqPrefix: 'bp' }),
    createQueue: (_qm: unknown, opts: { name: string }) => {
      if (opts.name.endsWith('-dlq')) {
        return {
          getJobs: (states: string[], start: number, end: number) => {
            const state = states[0] ?? 'waiting';
            const pool = dlqJobsByState[state] ?? [];
            return Promise.resolve(pool.slice(start, end + 1));
          },
          close: () => {
            dlqQueueCloseCalls += 1;
            return Promise.resolve();
          },
        };
      }
      return {
        add: (name: string, data: unknown, opts?: unknown) => {
          if (mainAddShouldThrow) {
            return Promise.reject(new Error('simulated_add_failure'));
          }
          addCalls.push({ name, data, opts });
          return Promise.resolve({ id: 'replayed-1' });
        },
        close: () => {
          mainQueueCloseCalls += 1;
          return Promise.resolve();
        },
      };
    },
    toDlqQueueName: (name: string) => `${name}-dlq`,
  },
});

mock.module(jobRunsPath, {
  namedExports: {
    createLexJobRunRecord: () => {
      createLexJobRunRecordCalls += 1;
      return Promise.resolve();
    },
  },
});

const { retryLexDlqToMainQueue } = await import('../lex-queues.js');

const TEST_QUEUE = 'lex.extract.fragments' as const;
const testEnv = {} as AppEnv;

function resetHarness(): void {
  dlqJobsByState = {};
  addCalls.length = 0;
  createLexJobRunRecordCalls = 0;
  mainQueueCloseCalls = 0;
  dlqQueueCloseCalls = 0;
  mainAddShouldThrow = false;
}

afterEach(() => {
  resetHarness();
});

describe('retryLexDlqToMainQueue', () => {
  beforeEach(() => {
    resetHarness();
  });

  test('returns zeros when DLQ has no jobs in any state', async () => {
    const result = await retryLexDlqToMainQueue({
      env: testEnv,
      queueName: TEST_QUEUE,
      maxJobs: 10,
    });

    assert.deepEqual(result, {
      retried: 0,
      skipped: 0,
      skippedTooOld: 0,
      skippedInvalid: 0,
      failed: 0,
    });
    assert.equal(mainQueueCloseCalls, 1);
    assert.equal(dlqQueueCloseCalls, 1);
  });

  test('caps maxJobs at 2000 and replays a valid young entry', async () => {
    const entry = baseDlqEntry();
    const removed: string[] = [];
    dlqJobsByState['waiting'] = [
      {
        id: 'j1',
        timestamp: Date.now(),
        data: entry,
        remove: () => {
          removed.push('j1');
          return Promise.resolve();
        },
      },
    ];

    const result = await retryLexDlqToMainQueue({
      env: testEnv,
      queueName: TEST_QUEUE,
      maxJobs: 999_999,
    });

    assert.equal(result.retried, 1);
    assert.equal(result.skippedInvalid, 0);
    assert.equal(result.skippedTooOld, 0);
    assert.equal(result.failed, 0);
    assert.equal(addCalls.length, 1);
    assert.equal(addCalls[0]?.name, entry.originalJobName);
    assert.equal(createLexJobRunRecordCalls, 1);
    assert.deepEqual(removed, ['j1']);
  });

  test('skips invalid DLQ payload shape', async () => {
    dlqJobsByState['waiting'] = [
      {
        id: 'bad',
        timestamp: Date.now(),
        data: { not: 'a dlq entry' },
        remove: () => Promise.resolve(),
      },
    ];

    const result = await retryLexDlqToMainQueue({ env: testEnv, queueName: TEST_QUEUE });

    assert.equal(result.retried, 0);
    assert.equal(result.skippedInvalid, 1);
    assert.equal(addCalls.length, 0);
  });

  test('skips when originalQueue does not match target main queue', async () => {
    dlqJobsByState['waiting'] = [
      {
        id: 'wrong-q',
        timestamp: Date.now(),
        data: baseDlqEntry({ originalQueue: 'lex.publish' }),
        remove: () => Promise.resolve(),
      },
    ];

    const result = await retryLexDlqToMainQueue({ env: testEnv, queueName: TEST_QUEUE });

    assert.equal(result.skippedInvalid, 1);
    assert.equal(result.retried, 0);
  });

  test('skips entries older than retention window', async () => {
    const eightDaysMs = 8 * 24 * 60 * 60 * 1000;
    const old = new Date(Date.now() - eightDaysMs).toISOString();
    dlqJobsByState['failed'] = [
      {
        id: 'old',
        timestamp: Date.now(),
        data: baseDlqEntry({ occurredAt: old }),
        remove: () => Promise.resolve(),
      },
    ];

    const result = await retryLexDlqToMainQueue({ env: testEnv, queueName: TEST_QUEUE });

    assert.equal(result.skippedTooOld, 1);
    assert.equal(result.retried, 0);
  });

  test('counts failure when mainQueue.add rejects', async () => {
    mainAddShouldThrow = true;
    dlqJobsByState['waiting'] = [
      {
        id: 'f1',
        timestamp: Date.now(),
        data: baseDlqEntry(),
        remove: () => Promise.resolve(),
      },
    ];

    const result = await retryLexDlqToMainQueue({ env: testEnv, queueName: TEST_QUEUE });

    assert.equal(result.failed, 1);
    assert.equal(result.retried, 0);
  });

  test('second job with same id is deduped without touching counters', async () => {
    const entry = baseDlqEntry();
    dlqJobsByState['waiting'] = [
      {
        id: 'same',
        timestamp: Date.now(),
        data: entry,
        remove: () => Promise.resolve(),
      },
      {
        id: 'same',
        timestamp: Date.now(),
        data: entry,
        remove: () => Promise.resolve(),
      },
    ];

    const result = await retryLexDlqToMainQueue({
      env: testEnv,
      queueName: TEST_QUEUE,
      maxJobs: 10,
    });

    assert.equal(result.retried, 1);
    assert.equal(result.skippedInvalid, 0);
    assert.equal(addCalls.length, 1);
  });

  test('respects maxJobs budget across invalid and retried work', async () => {
    dlqJobsByState['waiting'] = [
      {
        id: 'a',
        timestamp: Date.now(),
        data: { bad: true },
        remove: () => Promise.resolve(),
      },
      {
        id: 'b',
        timestamp: Date.now(),
        data: baseDlqEntry(),
        remove: () => Promise.resolve(),
      },
    ];

    const result = await retryLexDlqToMainQueue({
      env: testEnv,
      queueName: TEST_QUEUE,
      maxJobs: 1,
    });

    assert.equal(result.skippedInvalid + result.retried + result.skippedTooOld + result.failed, 1);
    assert.equal(result.skippedInvalid, 1);
    assert.equal(result.retried, 0);
    assert.equal(addCalls.length, 0);
  });
});
