import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { routes } from '../routes';

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: () => undefined,
}));

describe('auth callback UI', () => {
  it('renders an error state and retry link (no embedded gate)', async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ['/auth/callback?embedded=1&shop=example.myshopify.com&error=INVALID_HMAC'],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByText(/Autentificare eșuată/i)).toBeInTheDocument();
    expect(screen.getByText(/Cod: INVALID_HMAC/i)).toBeInTheDocument();

    const retry = screen.getByRole('link', { name: /Reîncearcă instalarea/i });
    expect(retry).toHaveAttribute(
      'href',
      expect.stringContaining('/auth?shop=example.myshopify.com')
    );
  });

  it('normalizes unknown error codes to INTERNAL_ERROR', async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ['/auth/callback?shop=example.myshopify.com&error=WHAT_EVEN_IS_THIS'],
    });

    render(<RouterProvider router={router} />);

    const titles = await screen.findAllByText(/Autentificare eșuată/i);
    expect(titles.length).toBeGreaterThan(0);
    expect(screen.getByText(/Cod: INTERNAL_ERROR/i)).toBeInTheDocument();
  });

  it('does not render sensitive OAuth params', () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');

    const router = createMemoryRouter(routes, {
      initialEntries: [
        '/auth/callback?shop=example.myshopify.com&code=SECRET_CODE&state=SECRET_STATE&hmac=SECRET_HMAC',
      ],
    });

    render(<RouterProvider router={router} />);

    expect(screen.queryByText(/SECRET_CODE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SECRET_STATE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SECRET_HMAC/)).not.toBeInTheDocument();

    // Best-effort scrub (avoid leaving query params visible).
    expect(replaceState).toHaveBeenCalled();
    replaceState.mockRestore();
  });
});
