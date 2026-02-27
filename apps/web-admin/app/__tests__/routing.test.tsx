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
          goldenCount: 40,
          goldenRate: 0.4,
          avgQualityScore: 0.72,
          todayWebhooks: 15,
          queueBacklog: 3,
          enrichmentSuccessRate: 0.95,
          lastSyncAt: new Date().toISOString(),
          lastSyncStatus: 'completed',
          todayAiCost: 1.2,
        });
      }
      return Promise.resolve({});
    },
  }),
}));

describe('routing', () => {
  it('renders Dashboard at /', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/'] });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: /Bun[aăă]\s/i })).toBeInTheDocument();
    expect(screen.getAllByText(/procese active/i).length).toBeGreaterThan(0);
  });

  it('renders ErrorBoundary for unknown route (404)', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/does-not-exist'] });

    render(<RouterProvider router={router} />);

    expect(await screen.findByText(/Eroare 404/i)).toBeInTheDocument();
  });

  it('renders 500 error page for simulated loader failure', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/queues?mode=500'] });

    render(<RouterProvider router={router} />);

    expect(await screen.findByText(/Eroare 500/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reîncearcă/i })).toBeInTheDocument();
  });
});
