import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { routes } from '../routes';

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: () => undefined,
}));

describe('settings form', () => {
  it('shows validation errors from actionData', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/settings'] });

    render(<RouterProvider router={router} />);

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/Te rugăm să corectezi erorile/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Email invalid/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Shop domain este obligatoriu/i).length).toBeGreaterThan(0);
  });
});
