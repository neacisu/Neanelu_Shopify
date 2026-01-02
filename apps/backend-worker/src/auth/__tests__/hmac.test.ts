/**
 * Tests for HMAC Verification
 *
 * CONFORM: Plan_de_implementare F3.2.6
 * Unit tests for Shopify HMAC signature verification
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyShopifyHmac, parseQueryString } from '../hmac.js';

void describe('verifyShopifyHmac', () => {
  const TEST_SECRET = 'test_secret_key_123';

  function generateValidHmac(params: Record<string, string>, secret: string): string {
    const sortedKeys = Object.keys(params).sort();
    const message = sortedKeys.map((key) => `${key}=${params[key]}`).join('&');
    return createHmac('sha256', secret).update(message).digest('hex');
  }

  void it('should verify valid HMAC signature', () => {
    const params = {
      code: 'abc123',
      shop: 'test-store.myshopify.com',
      state: 'nonce123',
      timestamp: '1234567890',
    };

    const hmac = generateValidHmac(params, TEST_SECRET);
    const queryWithHmac = { ...params, hmac };

    assert.ok(verifyShopifyHmac(queryWithHmac, TEST_SECRET));
  });

  void it('should reject invalid HMAC signature', () => {
    const params = {
      code: 'abc123',
      shop: 'test-store.myshopify.com',
      state: 'nonce123',
      timestamp: '1234567890',
      hmac: 'invalid_hmac_signature',
    };

    assert.ok(!verifyShopifyHmac(params, TEST_SECRET));
  });

  void it('should reject when hmac is missing', () => {
    const params = {
      code: 'abc123',
      shop: 'test-store.myshopify.com',
    };

    assert.ok(!verifyShopifyHmac(params, TEST_SECRET));
  });

  void it('should reject tampered parameters', () => {
    const originalParams = {
      code: 'abc123',
      shop: 'test-store.myshopify.com',
      state: 'nonce123',
    };

    const hmac = generateValidHmac(originalParams, TEST_SECRET);

    // Attempt to tamper with shop parameter
    const tamperedParams = {
      ...originalParams,
      shop: 'evil-store.myshopify.com',
      hmac,
    };

    assert.ok(!verifyShopifyHmac(tamperedParams, TEST_SECRET));
  });

  void it('should be resistant to timing attacks', () => {
    // This is a basic check - actual timing attack resistance
    // is provided by timingSafeEqual in the implementation
    const params = {
      code: 'abc123',
      shop: 'test-store.myshopify.com',
      hmac: '0'.repeat(64), // Invalid but same length
    };

    // Should not throw, just return false
    assert.ok(!verifyShopifyHmac(params, TEST_SECRET));
  });
});

void describe('parseQueryString', () => {
  void it('should parse query string correctly', () => {
    const result = parseQueryString('code=abc123&shop=test.myshopify.com');
    assert.equal(result['code'], 'abc123');
    assert.equal(result['shop'], 'test.myshopify.com');
  });

  void it('should handle URL encoded values', () => {
    const result = parseQueryString('shop=test%2Bstore.myshopify.com');
    assert.equal(result['shop'], 'test+store.myshopify.com');
  });

  void it('should return empty object for empty string', () => {
    const result = parseQueryString('');
    assert.deepEqual(result, {});
  });
});
