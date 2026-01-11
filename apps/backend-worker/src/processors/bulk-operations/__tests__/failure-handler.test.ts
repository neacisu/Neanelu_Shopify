import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyBulkTerminalFailure } from '../failure-handler.js';

void describe('PR-038 bulk failure policy', () => {
  void it('treats CANCELED as permanent', () => {
    const d = classifyBulkTerminalFailure({ status: 'CANCELED', shopifyErrorCode: null });
    assert.equal(d.classification, 'permanent');
    assert.equal(d.shouldRetry, false);
    assert.equal(d.errorType, 'UNKNOWN');
  });

  void it('treats FAILED default as transient (bounded retries)', () => {
    const d = classifyBulkTerminalFailure({ status: 'FAILED', shopifyErrorCode: null });
    assert.equal(d.classification, 'transient');
    assert.equal(d.shouldRetry, true);
    assert.equal(d.errorType, 'NETWORK');
  });

  void it('treats THROTTLED as transient rate limited', () => {
    const d = classifyBulkTerminalFailure({ status: 'FAILED', shopifyErrorCode: 'THROTTLED' });
    assert.equal(d.classification, 'transient');
    assert.equal(d.shouldRetry, true);
    assert.equal(d.errorType, 'RATE_LIMITED');
  });

  void it('treats explicit ACCESS_DENIED as permanent', () => {
    const d = classifyBulkTerminalFailure({ status: 'FAILED', shopifyErrorCode: 'ACCESS_DENIED' });
    assert.equal(d.classification, 'permanent');
    assert.equal(d.shouldRetry, false);
    assert.equal(d.errorType, 'AUTH_FAILED');
  });
});
