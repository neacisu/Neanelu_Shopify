import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { sha256Hex } from '../index.js';

void describe('sha256Hex', () => {
  void it('produces deterministic output for same input', () => {
    const input = 'test input string';
    const hash1 = sha256Hex(input);
    const hash2 = sha256Hex(input);
    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64);
  });

  void it('produces different output for different input', () => {
    const hash1 = sha256Hex('input A');
    const hash2 = sha256Hex('input B');
    assert.notEqual(hash1, hash2);
  });

  void it('handles empty string', () => {
    const hash = sha256Hex('');
    assert.equal(hash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  void it('handles Unicode characters', () => {
    const hash = sha256Hex('Test unicode: cafea si fructe');
    assert.equal(hash.length, 64);
    assert.ok(/^[a-f0-9]{64}$/.test(hash));
  });

  void it('handles very long strings', () => {
    const longInput = 'x'.repeat(100_000);
    const hash = sha256Hex(longInput);
    assert.equal(hash.length, 64);
  });
});
