import '@testing-library/jest-dom/vitest';

import { vi } from 'vitest';

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

vi.stubGlobal(
  'fetch',
  vi.fn((input: RequestInfo | URL) => {
    const url = getRequestUrl(input);

    if (url.includes('/api/health/ready') || url.endsWith('/health/ready')) {
      return Promise.resolve(
        new Response(JSON.stringify({ status: 'ready', checks: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }

    return Promise.resolve(new Response('Not Found', { status: 404 }));
  })
);
