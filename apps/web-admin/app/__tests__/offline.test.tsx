import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { routes } from '../routes';

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: () => undefined,
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
