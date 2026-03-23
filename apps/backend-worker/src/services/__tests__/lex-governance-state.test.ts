import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { isLexGovernanceRequestCancellableStatus } from '../lex-governance.js';

void describe('isLexGovernanceRequestCancellableStatus', () => {
  void test('permite anularea în stările f3-02 (draft, pending_approval, approved, apply_failed)', () => {
    assert.equal(isLexGovernanceRequestCancellableStatus('draft'), true);
    assert.equal(isLexGovernanceRequestCancellableStatus('pending_approval'), true);
    assert.equal(isLexGovernanceRequestCancellableStatus('approved'), true);
    assert.equal(isLexGovernanceRequestCancellableStatus('apply_failed'), true);
  });

  void test('respinge stările terminale sau deja aplicate', () => {
    assert.equal(isLexGovernanceRequestCancellableStatus('applied'), false);
    assert.equal(isLexGovernanceRequestCancellableStatus('cancelled'), false);
    assert.equal(isLexGovernanceRequestCancellableStatus('rejected'), false);
  });
});
