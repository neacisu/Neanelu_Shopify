import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { routes } from '../routes';

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: () => undefined,
}));

const mockGetApi = vi.fn((path: string, init?: RequestInit) => {
  if (path === '/settings/shop') {
    return Promise.resolve({
      shopName: 'Neanelu Demo',
      shopDomain: 'demo.myshopify.com',
      shopEmail: 'owner@demo.com',
      preferences: { timezone: 'Europe/Bucharest', language: 'ro' },
    });
  }
  if (path === '/settings/ai' && init?.method === 'PUT') {
    return Promise.resolve({
      enabled: true,
      hasApiKey: true,
      openaiBaseUrl: 'https://api.openai.com',
      openaiEmbeddingsModel: 'text-embedding-3-large',
      embeddingBatchSize: 100,
      similarityThreshold: 0.8,
      availableModels: ['text-embedding-3-large'],
    });
  }
  if (path === '/settings/ai') {
    return Promise.resolve({
      enabled: false,
      hasApiKey: false,
      openaiBaseUrl: 'https://api.openai.com',
      openaiEmbeddingsModel: 'text-embedding-3-small',
      embeddingBatchSize: 100,
      similarityThreshold: 0.8,
      availableModels: ['text-embedding-3-small'],
    });
  }
  return Promise.resolve({});
});

const mockPostApi = vi.fn((path: string) => {
  if (path === '/settings/ai/health') {
    return Promise.resolve({
      status: 'ok',
      checkedAt: new Date().toISOString(),
    });
  }
  return Promise.resolve({});
});

vi.mock('../hooks/use-api', () => ({
  useApiClient: () => ({
    getApi: mockGetApi,
    postApi: mockPostApi,
  }),
}));

describe('settings form', () => {
  beforeEach(() => {
    mockGetApi.mockClear();
    mockPostApi.mockClear();
  });

  it('renders shop info from API', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/settings'] });

    render(<RouterProvider router={router} />);

    expect(await screen.findByDisplayValue('Neanelu Demo')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('demo.myshopify.com')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('owner@demo.com')).toBeInTheDocument();
  });

  it('saves OpenAI settings from tab', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(routes, { initialEntries: ['/settings'] });

    render(<RouterProvider router={router} />);

    await user.click(screen.getByRole('tab', { name: 'OpenAI' }));

    const saveButton = screen.getByRole('button', { name: /salvează setări openai/i });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockGetApi).toHaveBeenCalledWith(
        '/settings/ai',
        expect.objectContaining({ method: 'PUT' })
      );
    });
    expect(await screen.findByText(/Setările OpenAI au fost salvate/i)).toBeInTheDocument();
  });
});
