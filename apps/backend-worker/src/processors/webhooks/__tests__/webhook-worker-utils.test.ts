import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { NEANELU_BACKOFF_STRATEGY } from '@app/queue-manager';
import { computeWebhookJobBackoffMsForRetry, webhookJobIdString } from '../webhook-worker-utils.js';

void describe('webhookJobIdString', () => {
  void test('undefined când id lipsește sau este null', () => {
    assert.strictEqual(webhookJobIdString({}), undefined);
    assert.strictEqual(webhookJobIdString({ id: null }), undefined);
    assert.strictEqual(webhookJobIdString({ id: undefined }), undefined);
    assert.strictEqual(webhookJobIdString(null), undefined);
  });

  void test('stringifică id numeric sau string', () => {
    assert.strictEqual(webhookJobIdString({ id: 42 }), '42');
    assert.strictEqual(webhookJobIdString({ id: 'job-1' }), 'job-1');
  });

  void test('undefined pentru id obiect (nu [object Object])', () => {
    assert.strictEqual(webhookJobIdString({ id: { x: 1 } }), undefined);
  });
});

void describe('computeWebhookJobBackoffMsForRetry', () => {
  void test('returnează null fără attemptsMade utili', () => {
    assert.strictEqual(computeWebhookJobBackoffMsForRetry({}), null);
    assert.strictEqual(computeWebhookJobBackoffMsForRetry({ attemptsMade: 0 }), null);
  });

  void test('NEANELU_BACKOFF_STRATEGY → exp4BackoffMs (valoare finită > 0)', () => {
    const ms = computeWebhookJobBackoffMsForRetry({
      attemptsMade: 2,
      opts: { backoff: { type: NEANELU_BACKOFF_STRATEGY, delay: 1000 } },
    });
    assert.ok(ms !== null && typeof ms === 'number' && Number.isFinite(ms) && ms > 0);
  });

  void test('exponential: baseDelay * 2^(attemptsMade-1)', () => {
    assert.strictEqual(
      computeWebhookJobBackoffMsForRetry({
        attemptsMade: 3,
        opts: { backoff: { type: 'exponential', delay: 100 } },
      }),
      400
    );
  });

  void test('backoff numeric → delay constant între retry-uri (fără tip special)', () => {
    assert.strictEqual(
      computeWebhookJobBackoffMsForRetry({
        attemptsMade: 2,
        opts: { backoff: 5000 },
      }),
      5000
    );
  });

  void test('obiect backoff fără tip → baseDelay din delay', () => {
    assert.strictEqual(
      computeWebhookJobBackoffMsForRetry({
        attemptsMade: 1,
        opts: { backoff: { delay: 250 } },
      }),
      250
    );
  });
});
