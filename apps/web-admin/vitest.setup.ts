import '@testing-library/jest-dom/vitest';

import { vi } from 'vitest';

// JSDOM doesn't implement <dialog> APIs fully.
// Our UI uses showModal()/close() in JobDetailModal.
if (typeof HTMLDialogElement !== 'undefined') {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal?: () => void;
    close?: () => void;
    open?: boolean;
  };

  if (typeof proto.showModal !== 'function') {
    proto.showModal = function showModal() {
      (this as unknown as { open?: boolean }).open = true;
    };
  }

  if (typeof proto.close !== 'function') {
    proto.close = function close() {
      (this as unknown as { open?: boolean }).open = false;
    };
  }
}

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
