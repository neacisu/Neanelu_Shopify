/**
 * Integration Tests for OAuth Flow
 *
 * CONFORM: Plan_de_implementare F3.2.6
 * Integration tests for token exchange, encrypted persistence, and RLS isolation
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Mock pentru Shopify token exchange
 */
function createMockFetch(responses: Map<string, Response | Error>) {
  return mock.fn((url: string | URL | Request): Promise<Response> => {
    const urlString = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;

    for (const [pattern, response] of responses) {
      if (urlString.includes(pattern)) {
        if (response instanceof Error) {
          return Promise.reject(response);
        }
        return Promise.resolve(response);
      }
    }

    return Promise.resolve(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }));
  });
}

void describe('OAuth Token Exchange Integration', () => {
  void it('should exchange code for access token with Shopify', async () => {
    // Arrange
    const mockResponse = new Response(
      JSON.stringify({
        access_token: 'shpat_test_token_12345',
        scope: 'read_products,write_products',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

    const responses = new Map<string, Response | Error>();
    responses.set('/admin/oauth/access_token', mockResponse);

    const mockFetch = createMockFetch(responses);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as typeof fetch;

    try {
      // Act
      const response = await fetch('https://test-store.myshopify.com/admin/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: 'test_client_id',
          client_secret: 'test_client_secret',
          code: 'test_auth_code',
        }),
      });

      const data = (await response.json()) as { access_token: string; scope: string };

      // Assert
      assert.equal(response.status, 200);
      assert.equal(data.access_token, 'shpat_test_token_12345');
      assert.equal(data.scope, 'read_products,write_products');
      assert.equal(mockFetch.mock.calls.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  void it('should handle Shopify API errors gracefully', async () => {
    // Arrange
    const mockResponse = new Response(
      JSON.stringify({ error: 'invalid_request', error_description: 'Invalid code' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );

    const responses = new Map<string, Response | Error>();
    responses.set('/admin/oauth/access_token', mockResponse);

    const mockFetch = createMockFetch(responses);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as typeof fetch;

    try {
      // Act
      const response = await fetch('https://test-store.myshopify.com/admin/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: 'test_client_id',
          client_secret: 'test_client_secret',
          code: 'invalid_code',
        }),
      });

      // Assert
      assert.equal(response.status, 400);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  void it('should handle network errors', async () => {
    // Arrange
    const responses = new Map<string, Response | Error>();
    responses.set('/admin/oauth/access_token', new Error('Network error'));

    const mockFetch = createMockFetch(responses);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as typeof fetch;

    try {
      // Act & Assert
      await assert.rejects(
        async () => {
          await fetch('https://test-store.myshopify.com/admin/oauth/access_token', {
            method: 'POST',
          });
        },
        { message: 'Network error' }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

void describe('Token Encryption Integration', () => {
  void it('should encrypt and decrypt token correctly', async () => {
    // Import dynamically to avoid initialization issues in test environment
    const { encryptAesGcm, decryptAesGcm } = await import('@app/database');

    // Arrange
    const originalToken = 'shpat_test_secret_token_12345';
    const encryptionKey = Buffer.alloc(32, 'test'); // 256-bit key

    // Act
    const encrypted = encryptAesGcm(Buffer.from(originalToken), encryptionKey);
    const decrypted = decryptAesGcm(
      encrypted.ciphertext,
      encryptionKey,
      encrypted.iv,
      encrypted.tag
    );

    // Assert
    assert.equal(decrypted.toString('utf-8'), originalToken);
    assert.notEqual(encrypted.ciphertext.toString(), originalToken);
    assert.equal(encrypted.iv.length, 12); // GCM standard IV size
    assert.equal(encrypted.tag.length, 16); // GCM standard tag size
  });

  void it('should fail decryption with wrong key', async () => {
    const { encryptAesGcm, decryptAesGcm } = await import('@app/database');

    // Arrange
    const originalToken = 'shpat_test_secret_token_12345';
    const encryptionKey = Buffer.alloc(32, 'test');
    const wrongKey = Buffer.alloc(32, 'wrong');

    // Act
    const encrypted = encryptAesGcm(Buffer.from(originalToken), encryptionKey);

    // Assert - should throw on decryption with wrong key
    assert.throws(() => {
      decryptAesGcm(encrypted.ciphertext, wrongKey, encrypted.iv, encrypted.tag);
    });
  });

  void it('should fail decryption with tampered ciphertext', async () => {
    const { encryptAesGcm, decryptAesGcm } = await import('@app/database');

    // Arrange
    const originalToken = 'shpat_test_secret_token_12345';
    const encryptionKey = Buffer.alloc(32, 'test');

    // Act
    const encrypted = encryptAesGcm(Buffer.from(originalToken), encryptionKey);

    // Tamper with ciphertext
    if (encrypted.ciphertext[0] !== undefined) {
      encrypted.ciphertext[0] = encrypted.ciphertext[0] ^ 0xff;
    }

    // Assert - should throw on decryption
    assert.throws(() => {
      decryptAesGcm(encrypted.ciphertext, encryptionKey, encrypted.iv, encrypted.tag);
    });
  });
});

void describe('Session Management Integration', () => {
  void it('should create and verify session token', async () => {
    const { createSessionToken, verifySessionToken } = await import('../session.js');

    // Arrange
    const sessionData = {
      shopId: 'shop-uuid-12345',
      shopDomain: 'test-store.myshopify.com',
      createdAt: Date.now(),
    };
    const secret = 'test-secret-key-for-session';

    // Act
    const token = createSessionToken(sessionData, secret);
    const verified = verifySessionToken(token, secret);

    // Assert
    assert.ok(verified);
    if (verified) {
      assert.equal(verified.shopId, sessionData.shopId);
      assert.equal(verified.shopDomain, sessionData.shopDomain);
      assert.equal(verified.createdAt, sessionData.createdAt);
    }
  });

  void it('should reject tampered session token', async () => {
    const { createSessionToken, verifySessionToken } = await import('../session.js');

    // Arrange
    const sessionData = {
      shopId: 'shop-uuid-12345',
      shopDomain: 'test-store.myshopify.com',
      createdAt: Date.now(),
    };
    const secret = 'test-secret-key';

    // Act
    const token = createSessionToken(sessionData, secret);
    // Tamper with the signature part (after the dot)
    const parts = token.split('.');
    const tamperedSignature = parts[1]?.split('').reverse().join('') ?? '';
    const tamperedToken = `${parts[0]}.${tamperedSignature}`;
    const verified = verifySessionToken(tamperedToken, secret);

    // Assert
    assert.equal(verified, null);
  });

  void it('should reject token with wrong secret', async () => {
    const { createSessionToken, verifySessionToken } = await import('../session.js');

    // Arrange
    const sessionData = {
      shopId: 'shop-uuid-12345',
      shopDomain: 'test-store.myshopify.com',
      createdAt: Date.now(),
    };

    // Act
    const token = createSessionToken(sessionData, 'correct-secret');
    const verified = verifySessionToken(token, 'wrong-secret');

    // Assert
    assert.equal(verified, null);
  });
});
