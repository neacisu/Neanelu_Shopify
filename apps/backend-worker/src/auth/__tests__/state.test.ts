/**
 * Tests for OAuth State Management
 *
 * CONFORM: Plan_de_implementare F3.2.6
 * Unit tests for state/CSRF token generation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSecureState,
  generateNonce,
  getStateExpiration,
  isStateValid,
  type OAuthStateRecord,
} from '../state.js';

void describe('generateSecureState', () => {
  void it('should generate 64-character hex string', () => {
    const state = generateSecureState();
    assert.equal(state.length, 64);
    assert.ok(/^[0-9a-f]+$/.test(state));
  });

  void it('should generate unique values', () => {
    const states = new Set<string>();
    for (let i = 0; i < 100; i++) {
      states.add(generateSecureState());
    }
    assert.equal(states.size, 100, 'All generated states should be unique');
  });
});

void describe('generateNonce', () => {
  void it('should generate 32-character hex string', () => {
    const nonce = generateNonce();
    assert.equal(nonce.length, 32);
    assert.ok(/^[0-9a-f]+$/.test(nonce));
  });

  void it('should generate unique values', () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 100; i++) {
      nonces.add(generateNonce());
    }
    assert.equal(nonces.size, 100, 'All generated nonces should be unique');
  });
});

void describe('getStateExpiration', () => {
  void it('should return future date with default TTL', () => {
    const before = Date.now();
    const expiration = getStateExpiration();
    const after = Date.now();

    // Default is 10 minutes
    const expectedMin = before + 10 * 60 * 1000;
    const expectedMax = after + 10 * 60 * 1000;

    assert.ok(expiration.getTime() >= expectedMin);
    assert.ok(expiration.getTime() <= expectedMax);
  });

  void it('should respect custom TTL', () => {
    const before = Date.now();
    const expiration = getStateExpiration(5); // 5 minutes
    const after = Date.now();

    const expectedMin = before + 5 * 60 * 1000;
    const expectedMax = after + 5 * 60 * 1000;

    assert.ok(expiration.getTime() >= expectedMin);
    assert.ok(expiration.getTime() <= expectedMax);
  });
});

void describe('isStateValid', () => {
  const baseRecord: OAuthStateRecord = {
    id: 'test-id',
    state: 'test-state',
    shopDomain: 'test.myshopify.com',
    redirectUri: 'https://app.com/callback',
    nonce: 'nonce123',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // Future
    usedAt: null,
    createdAt: new Date(),
  };

  void it('should return true for valid record', () => {
    assert.ok(isStateValid(baseRecord));
  });

  void it('should return false for null record', () => {
    assert.ok(!isStateValid(null));
  });

  void it('should return false for already used record', () => {
    const usedRecord = { ...baseRecord, usedAt: new Date() };
    assert.ok(!isStateValid(usedRecord));
  });

  void it('should return false for expired record', () => {
    const expiredRecord = {
      ...baseRecord,
      expiresAt: new Date(Date.now() - 1000), // Past
    };
    assert.ok(!isStateValid(expiredRecord));
  });
});
