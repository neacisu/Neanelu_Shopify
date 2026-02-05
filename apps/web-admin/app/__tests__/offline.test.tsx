import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { routes } from '../routes';

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: () => undefined,
}));

vi.mock('../lib/api-client', () => ({
  createApiClient: () => ({
    getApi: (path: string) => {
      if (path === '/dashboard/summary') {
        return Promise.resolve({
          totalProducts: 100,
          activeBulkRuns: 2,
          apiErrorRate: 0.01,
          apiLatencyP95Ms: 120,
        });
      }
      return Promise.reject(new Error(`Unexpected API path: ${path}`));
    },
  }),
}));

describe('offline gate', () => {
  it('renders Offline page when navigator is offline', async () => {
    const original = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });

    const router = createMemoryRouter(routes, { initialEntries: ['/'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: /Offline/i })).toBeInTheDocument();

    if (original) {
      Object.defineProperty(window.navigator, 'onLine', original);
    }
  });
});
