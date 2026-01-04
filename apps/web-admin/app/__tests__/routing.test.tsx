import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { routes } from '../routes';

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: () => undefined,
}));

describe('routing', () => {
  it('renders Dashboard at /', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/'] });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: /Neanelu Monitor/i })).toBeInTheDocument();
    expect(screen.getByText(/System Overview/i)).toBeInTheDocument();
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
