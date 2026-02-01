import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { routes } from '../routes';

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: () => undefined,
}));

const mockGetApi = vi.fn((_: string, init?: RequestInit) => {
  if (init?.method === 'PUT') {
    return Promise.resolve({
      enabled: true,
      hasApiKey: true,
      openaiBaseUrl: 'https://api.openai.com',
      openaiEmbeddingsModel: 'text-embedding-3-large',
    });
  }
  return Promise.resolve({
    enabled: false,
    hasApiKey: false,
    openaiBaseUrl: 'https://api.openai.com',
    openaiEmbeddingsModel: 'text-embedding-3-small',
  });
});

vi.mock('../hooks/use-api', () => ({
  useApiClient: () => ({
    getApi: mockGetApi,
  }),
}));

describe('settings form', () => {
  beforeEach(() => {
    mockGetApi.mockClear();
  });

  it('shows validation errors from actionData', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/settings'] });

    render(<RouterProvider router={router} />);

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/Te rugăm să corectezi erorile/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Email invalid/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Shop domain este obligatoriu/i).length).toBeGreaterThan(0);
  });

  it('saves OpenAI settings from tab', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/settings'] });

    render(<RouterProvider router={router} />);

    await user.click(screen.getByRole('button', { name: 'OpenAI' }));

    const apiKeyInput = await screen.findByLabelText('OpenAI API Key');
    await user.type(apiKeyInput, 'sk-test');

    await user.click(screen.getByRole('button', { name: /save openai settings/i }));

    expect(mockGetApi).toHaveBeenCalledWith(
      '/settings/ai',
      expect.objectContaining({ method: 'PUT' })
    );
    expect(await screen.findByText(/Setările OpenAI au fost salvate/i)).toBeInTheDocument();
  });
});
