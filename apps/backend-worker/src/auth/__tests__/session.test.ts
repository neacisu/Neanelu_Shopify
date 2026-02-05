import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyRequest } from 'fastify';

import { createSessionToken, getSessionFromRequest, type SessionData } from '../session.js';

void describe('session tokens', () => {
  const config = {
    secret: 'test-secret',
    cookieName: 'neanelu_session',
    maxAge: 3600,
  } as const;

  void it('accepts session token from query param', () => {
    const data: SessionData = {
      shopId: 'shop-1',
      shopDomain: 'shop-1.myshopify.com',
      createdAt: Date.now(),
    };
    const token = createSessionToken(data, config.secret);
    const request = {
      headers: {},
      cookies: {},
      query: { token },
    } as unknown as FastifyRequest;

    const session = getSessionFromRequest(request, config);
    assert.ok(session);
    assert.equal(session?.shopId, data.shopId);
    assert.equal(session?.shopDomain, data.shopDomain);
  });
});
