import '@testing-library/jest-dom/vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

import { cleanup } from '@testing-library/react';

import type { ReactNode } from 'react';
import { cloneElement, createElement, isValidElement } from 'react';
import { afterEach, expect, vi } from 'vitest';

import type * as Recharts from 'recharts';

// Note: Vitest is configured with `globals: false`, so Testing Library cannot register
// its auto-cleanup via a global `afterEach`. Ensure we always unmount between tests.
afterEach(() => {
  cleanup();
});

// Ensure Testing Library matchers are registered even when globals are disabled.
expect.extend(matchers);

// Recharts ResponsiveContainer relies on real layout measurement.
// In JSDOM, it can compute -1 sizes and spam stderr.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof Recharts>('recharts');

  const width = 800;
  const height = 400;

  interface SizedChildProps {
    width?: number;
    height?: number;
  }

  function withDimensions(node: ReactNode): ReactNode {
    if (isValidElement<SizedChildProps>(node)) {
      return cloneElement<SizedChildProps>(node, { width, height });
    }
    return node;
  }

  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children?: ReactNode | ((dimensions: { width: number; height: number }) => ReactNode);
    }) => {
      if (typeof children === 'function') {
        return children({ width, height });
      }

      if (Array.isArray(children)) {
        return createElement('div', { style: { width, height } }, children.map(withDimensions));
      }

      return createElement('div', { style: { width, height } }, withDimensions(children));
    },
  };
});

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

// JSDOM doesn't implement matchMedia, which is required by some libraries (e.g. TanStack Query DevTools).
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

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
