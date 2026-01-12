import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyBulkMutationResultLineFailure } from './requeue-policy.js';

void describe('classifyBulkMutationResultLineFailure', () => {
  void it('treats userErrors as permanent by default', () => {
    const res = classifyBulkMutationResultLineFailure({
      userErrors: [{ message: 'Value is invalid', code: 'INVALID' }],
      graphqlErrors: [],
    });
    assert.equal(res.classification, 'permanent');
  });

  void it('treats THROTTLED/429 GraphQL errors as recoverable', () => {
    const res = classifyBulkMutationResultLineFailure({
      graphqlErrors: [{ message: 'THROTTLED: Too many requests (429)' }],
      userErrors: [],
    });
    assert.equal(res.classification, 'recoverable');
  });

  void it('treats parse errors as permanent', () => {
    const res = classifyBulkMutationResultLineFailure({ parseError: true });
    assert.equal(res.classification, 'permanent');
  });
});
