/**
 * Tests for OAuth Validation
 *
 * CONFORM: Plan_de_implementare F3.2.6
 * Unit tests for shop parameter validation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidShopDomain,
  sanitizeShopDomain,
  validateShopParam,
  buildAuthorizationUrl,
} from '../validation.js';

void describe('isValidShopDomain', () => {
  void it('should accept valid shop domains', () => {
    assert.ok(isValidShopDomain('my-store.myshopify.com'));
    assert.ok(isValidShopDomain('store123.myshopify.com'));
    assert.ok(isValidShopDomain('a1.myshopify.com'));
    assert.ok(isValidShopDomain('test-shop-name.myshopify.com'));
  });

  void it('should reject invalid shop domains', () => {
    assert.ok(!isValidShopDomain(''));
    assert.ok(!isValidShopDomain(null));
    assert.ok(!isValidShopDomain(undefined));
    assert.ok(!isValidShopDomain(123));
    assert.ok(!isValidShopDomain('example.com'));
    assert.ok(!isValidShopDomain('myshopify.com'));
    assert.ok(!isValidShopDomain('.myshopify.com'));
    assert.ok(!isValidShopDomain('store.evil.com'));
    assert.ok(!isValidShopDomain('store.myshopify.com.evil.com'));
    assert.ok(!isValidShopDomain('https://store.myshopify.com'));
    assert.ok(!isValidShopDomain('store.myshopify.com/admin'));
  });

  void it('should reject domains starting or ending with hyphen', () => {
    assert.ok(!isValidShopDomain('-store.myshopify.com'));
    assert.ok(!isValidShopDomain('store-.myshopify.com'));
  });

  void it('should be case insensitive', () => {
    assert.ok(isValidShopDomain('MyStore.myshopify.com'));
    assert.ok(isValidShopDomain('MYSTORE.MYSHOPIFY.COM'));
  });
});

void describe('sanitizeShopDomain', () => {
  void it('should normalize valid domains to lowercase', () => {
    assert.equal(sanitizeShopDomain('MyStore.myshopify.com'), 'mystore.myshopify.com');
    assert.equal(sanitizeShopDomain('STORE.MYSHOPIFY.COM'), 'store.myshopify.com');
  });

  void it('should return null for invalid domains', () => {
    assert.equal(sanitizeShopDomain('example.com'), null);
    assert.equal(sanitizeShopDomain(''), null);
    assert.equal(sanitizeShopDomain(null), null);
  });
});

void describe('validateShopParam', () => {
  void it('should return valid result for good shop', () => {
    const result = validateShopParam('my-store.myshopify.com');
    assert.ok(result.valid);
    if (result.valid) {
      assert.equal(result.shop, 'my-store.myshopify.com');
    }
  });

  void it('should return error for missing shop', () => {
    const result = validateShopParam(undefined);
    assert.ok(!result.valid);
    if (!result.valid) {
      assert.ok(result.error.includes('Missing'));
    }
  });

  void it('should return error for invalid format', () => {
    const result = validateShopParam('evil.com');
    assert.ok(!result.valid);
    if (!result.valid) {
      assert.ok(result.error.includes('Invalid'));
    }
  });
});

void describe('buildAuthorizationUrl', () => {
  void it('should build valid authorization URL', () => {
    const url = buildAuthorizationUrl({
      shop: 'test-store.myshopify.com',
      clientId: 'client123',
      scopes: 'read_products,write_products',
      redirectUri: 'https://app.example.com/callback',
      state: 'abc123state',
    });

    assert.ok(url.startsWith('https://test-store.myshopify.com/admin/oauth/authorize'));
    assert.ok(url.includes('client_id=client123'));
    assert.ok(url.includes('scope=read_products'));
    assert.ok(url.includes('state=abc123state'));
  });
});
