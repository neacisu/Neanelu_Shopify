import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  clearSessionTokenCache,
  getCachedSessionTokenExpiresAtMs,
  getSessionToken,
} from '../lib/session-auth';
import { createApiClient } from '../lib/api-client';

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...(init ?? {}),
  });
}

describe('PR-028 session UX primitives', () => {
  beforeEach(() => {
    clearSessionTokenCache();
    vi.restoreAllMocks();

    // Keep tests deterministic: force cookie-minted token path (no App Bridge).
    // In vitest, import.meta.env is provided by Vite; setting the key to empty disables the App Bridge branch.
    const env = import.meta.env as unknown as { VITE_SHOPIFY_API_KEY?: string };
    env.VITE_SHOPIFY_API_KEY = '';

    window.history.replaceState({}, '', '/?shop=a.myshopify.com&host=abc&embedded=1');
  });

  it('honors expiresAt for cookie-minted tokens', async () => {
    const expiresAt = '2099-01-01T00:00:00.000Z';

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: { token: 'payload.signature', expiresAt }, meta: {} })
      );

    const token = await getSessionToken();
    expect(token).toBe('payload.signature');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    expect(getCachedSessionTokenExpiresAtMs()).toBe(Date.parse(expiresAt));
  });

  it('clears cache when shop/host changes (multi-shop)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { token: 'payload.signature', expiresAt: '2099-01-01T00:00:00.000Z' },
          meta: {},
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { token: 'payload2.signature2', expiresAt: '2099-01-02T00:00:00.000Z' },
          meta: {},
        })
      );

    expect(await getSessionToken()).toBe('payload.signature');
    const callsAfterFirst = fetchSpy.mock.calls.length;

    window.history.replaceState({}, '', '/?shop=b.myshopify.com&host=def&embedded=1');
    expect(await getSessionToken()).toBe('payload2.signature2');

    // The key behavior: changing shop/host forces a refetch (cache isolation).
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('api client retries once on 401', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('nope', { status: 401 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const client = createApiClient({
      baseUrl: '',
      fetchImpl,
      getAuthHeaders: () => Promise.resolve({ Authorization: 'Bearer t' }),
    });

    const res = await client.request('/health/live');
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
