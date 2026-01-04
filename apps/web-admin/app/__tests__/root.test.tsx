import { render, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { routes } from '../routes';

const toastMock = vi.fn();

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: (...args: unknown[]) => toastMock(...args),
}));

describe('Root side-effects', () => {
  it('injects Polaris CDN script only once', async () => {
    document.head.innerHTML = '';

    const router = createMemoryRouter(routes, { initialEntries: ['/'] });
    const { unmount } = render(<RouterProvider router={router} />);

    const selector = 'script[data-neanelu-polaris="1"]';
    await waitFor(() => {
      expect(document.head.querySelectorAll(selector)).toHaveLength(1);
    });

    unmount();

    const router2 = createMemoryRouter(routes, { initialEntries: ['/'] });
    render(<RouterProvider router={router2} />);

    await waitFor(() => {
      expect(document.head.querySelectorAll(selector)).toHaveLength(1);
      expect(toastMock).toHaveBeenCalled();
    });
  });
});
