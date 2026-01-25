import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { __testing_resolveGroupId } from '../ai.js';

void describe('ai batch queue group id', () => {
  void it('normalizes shop id for group id', () => {
    const id = __testing_resolveGroupId('A0B1C2D3-E4F5-4678-9ABC-DEF123456789');
    assert.equal(id, 'a0b1c2d3-e4f5-4678-9abc-def123456789');
  });

  void it('rejects invalid shop id', () => {
    const id = __testing_resolveGroupId('not-a-uuid');
    assert.equal(id, null);
  });
});
