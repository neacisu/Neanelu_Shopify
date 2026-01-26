import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyEmbeddingError } from '../error-classifier.js';

void describe('embedding error classifier', () => {
  void it('classifies dimension mismatch as permanent', () => {
    const decision = classifyEmbeddingError('embedding_dimension_mismatch:1536');
    assert.equal(decision.classification, 'permanent');
    assert.equal(decision.shouldRetry, false);
    assert.equal(decision.errorType, 'DIMENSION_MISMATCH');
  });

  void it('classifies rate limits as transient', () => {
    const decision = classifyEmbeddingError('HTTP 429: rate limit exceeded');
    assert.equal(decision.classification, 'transient');
    assert.equal(decision.shouldRetry, true);
  });

  void it('classifies invalid content as permanent', () => {
    const decision = classifyEmbeddingError('invalid content');
    assert.equal(decision.classification, 'permanent');
    assert.equal(decision.shouldRetry, false);
    assert.equal(decision.errorType, 'INVALID_CONTENT');
  });
});
