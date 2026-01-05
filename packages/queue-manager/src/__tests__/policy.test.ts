import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_QUEUE_TIMEOUTS_MS,
  defaultJobTimeoutMs,
  defaultQueuePolicy,
  exp4BackoffMs,
  NEANELU_BACKOFF_STRATEGY,
} from '../policy.js';

void describe('exp4BackoffMs', () => {
  void it('uses a factor-4 schedule (1s, 4s, 16s...)', () => {
    assert.equal(exp4BackoffMs(1), 1000);
    assert.equal(exp4BackoffMs(2), 4000);
    assert.equal(exp4BackoffMs(3), 16000);
  });
});

void describe('defaultQueuePolicy', () => {
  void it('sets attempts=3 and the neanelu backoff strategy', () => {
    const policy = defaultQueuePolicy();
    assert.equal(policy.attempts, 3);

    assert.equal(typeof policy.backoff, 'object');
    assert.notEqual(policy.backoff, null);
    const backoff = policy.backoff as { type?: unknown };
    assert.equal(backoff.type, NEANELU_BACKOFF_STRATEGY);
  });
});

void describe('defaultJobTimeoutMs', () => {
  void it('returns the standardized timeout for each known queue', () => {
    for (const [queueName, timeout] of Object.entries(DEFAULT_QUEUE_TIMEOUTS_MS)) {
      assert.equal(
        defaultJobTimeoutMs(queueName as keyof typeof DEFAULT_QUEUE_TIMEOUTS_MS),
        timeout
      );
    }
  });
});
