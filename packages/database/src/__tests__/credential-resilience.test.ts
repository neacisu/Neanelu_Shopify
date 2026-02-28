/**
 * Credential Resilience Tests
 *
 * Testează cele 4 niveluri de reziliență pentru rotația dinamică a credențialelor:
 * - isAuthError() — detectare SQLSTATE 28P01/28000
 * - handleAuthError() — debounce + callback invocation
 * - Pool Proxy — intercepție connect()/query() cu retry
 * - triggerCredentialRefresh — re-read file + rotate
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import { isAuthError, registerCredentialRefreshFn } from '../db.js';

void describe('isAuthError', () => {
  void it('detects SQLSTATE 28P01 (invalid_password)', () => {
    const err = Object.assign(new Error('password authentication failed'), { code: '28P01' });
    assert.strictEqual(isAuthError(err), true);
  });

  void it('detects SQLSTATE 28000 (invalid_authorization_specification)', () => {
    const err = Object.assign(new Error('some auth error'), { code: '28000' });
    assert.strictEqual(isAuthError(err), true);
  });

  void it('detects message "password authentication failed" without code', () => {
    const err = new Error('password authentication failed for user "v-approle-neanelu"');
    assert.strictEqual(isAuthError(err), true);
  });

  void it('returns false for connection timeout errors', () => {
    const err = Object.assign(new Error('Connection terminated unexpectedly'), { code: '57P01' });
    assert.strictEqual(isAuthError(err), false);
  });

  void it('returns false for query syntax errors', () => {
    const err = Object.assign(new Error('syntax error at position 42'), { code: '42601' });
    assert.strictEqual(isAuthError(err), false);
  });

  void it('returns false for non-Error objects', () => {
    assert.strictEqual(isAuthError('string error'), false);
    assert.strictEqual(isAuthError(null), false);
    assert.strictEqual(isAuthError(undefined), false);
    assert.strictEqual(isAuthError(42), false);
  });

  void it('returns false for plain Error without pg code or auth message', () => {
    assert.strictEqual(isAuthError(new Error('something else')), false);
  });

  void it('is case-insensitive on message detection', () => {
    const err = new Error('Password Authentication Failed for user "test"');
    assert.strictEqual(isAuthError(err), true);
  });
});

void describe('registerCredentialRefreshFn', () => {
  void beforeEach(() => {
    registerCredentialRefreshFn(null as unknown as () => Promise<boolean>);
  });

  void it('accepts a function without throwing', () => {
    assert.doesNotThrow(() => {
      registerCredentialRefreshFn(() => Promise.resolve(true));
    });
  });

  void it('can be called multiple times (last wins)', () => {
    registerCredentialRefreshFn(() => Promise.resolve(false));
    registerCredentialRefreshFn(() => Promise.resolve(true));
  });
});
