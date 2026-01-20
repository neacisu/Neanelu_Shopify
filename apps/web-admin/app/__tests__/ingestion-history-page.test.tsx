import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import IngestionHistoryPage, {
  action as historyAction,
  loader as historyLoader,
} from '../routes/ingestion.history';

interface ApiClient {
  getApi: <T>(path: string, init?: RequestInit) => Promise<T>;
  postApi: <
    TResponse = unknown,
    TBody extends Record<string, unknown> | FormData = Record<string, unknown>,
  >(
    path: string,
    body: TBody,
    init?: RequestInit
  ) => Promise<TResponse>;
}

const apiCalls: { method: 'GET' | 'POST'; path: string; body?: unknown }[] = [];

function createApiStub(): ApiClient {
  return {
    getApi<T>(path: string): Promise<T> {
      apiCalls.push({ method: 'GET', path });

      if (path.startsWith('/bulk?')) {
        return Promise.resolve({
          runs: [
            {
              id: 'run-1',
              status: 'failed',
              startedAt: '2024-01-01T00:00:00.000Z',
              completedAt: '2024-01-01T00:01:00.000Z',
              recordsProcessed: 10,
              errorCount: 2,
            },
          ],
          total: 1,
        } as T);
      }

      if (path.includes('/errors')) {
        return Promise.resolve({ errors: [] } as T);
      }

      return Promise.reject(new Error(`unhandled_get:${path}`));
    },

    postApi<TResponse, TBody extends Record<string, unknown> | FormData>(
      path: string,
      body: TBody
    ): Promise<TResponse> {
      apiCalls.push({ method: 'POST', path, body });
      if (path === '/bulk/run-1/retry') {
        return Promise.resolve({ ok: true } as TResponse);
      }
      return Promise.reject(new Error(`unhandled_post:${path}`));
    },
  };
}

const api = vi.hoisted(() => createApiStub());

vi.mock('../lib/api-client', () => ({
  createApiClient: () => api,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  Toaster: () => null,
}));

describe('Ingestion history page', () => {
  beforeEach(() => {
    apiCalls.splice(0, apiCalls.length);
  });

  it('submits retry with selected mode', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <Outlet />,
          children: [
            {
              path: 'ingestion/history',
              element: <IngestionHistoryPage />,
              loader: historyLoader,
              action: historyAction,
            },
          ],
        },
      ],
      { initialEntries: ['/ingestion/history'] }
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByText(/1 runs/i)).toBeInTheDocument();

    const user = userEvent.setup();
    const retryButtons = screen.getAllByRole('button', { name: 'Retry' });
    await user.click(retryButtons[0]!);

    await user.click(screen.getByRole('radio', { name: 'Full restart' }));

    const modalRetryButtons = screen.getAllByRole('button', { name: 'Retry' });
    await user.click(modalRetryButtons[modalRetryButtons.length - 1]!);

    await waitFor(() => {
      const call = apiCalls.find((c) => c.method === 'POST' && c.path === '/bulk/run-1/retry');
      expect(call).toBeDefined();
      expect(call?.body).toEqual({ mode: 'restart' });
    });
  });
});
