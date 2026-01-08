import { describe, expect, it } from 'vitest';

import { withShopifyQueryRedirect } from '../actions';

describe('withShopifyQueryRedirect', () => {
  it('strips /app basename and preserves Shopify query params', () => {
    const request = new Request(
      'https://example.test/app/queues?host=host123&shop=shop123.myshopify.com&embedded=1'
    );

    const res = withShopifyQueryRedirect({ request }, '/app/queues?tab=jobs');
    const location = res.headers.get('Location');

    expect(location).toBeTruthy();
    expect(location).toMatch(/^\/queues\?/);
    expect(location).toContain('tab=jobs');
    expect(location).toContain('host=host123');
    expect(location).toContain('shop=shop123.myshopify.com');
    expect(location).toContain('embedded=1');
  });

  it('blocks open redirects', () => {
    const request = new Request(
      'https://example.test/app/queues?host=host123&shop=shop123.myshopify.com&embedded=1'
    );

    const res = withShopifyQueryRedirect({ request }, 'https://evil.example/phish');
    const location = res.headers.get('Location');

    expect(location).toBe('/');
  });
});
