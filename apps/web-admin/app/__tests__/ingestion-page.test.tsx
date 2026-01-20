import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import IngestionPage, {
  action as ingestionAction,
  loader as ingestionLoader,
} from '../routes/ingestion';

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

      if (path === '/bulk/current') {
        return Promise.resolve(null as T);
      }

      if (path === '/bulk/active-shopify') {
        return Promise.resolve({ operation: null } as T);
      }

      if (path.startsWith('/bulk?')) {
        return Promise.resolve({ runs: [] } as T);
      }

      return Promise.reject(new Error(`unhandled_get:${path}`));
    },

    postApi<TResponse, TBody extends Record<string, unknown> | FormData>(
      path: string,
      body: TBody
    ): Promise<TResponse> {
      apiCalls.push({ method: 'POST', path, body });

      if (path === '/bulk/start') {
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

vi.mock('../hooks/use-log-stream', () => ({
  useLogStream: () => ({
    logs: [],
    connected: true,
    error: null,
    paused: false,
    pause: vi.fn(),
    resume: vi.fn(),
    clear: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  Toaster: () => null,
}));

describe('Ingestion page', () => {
  beforeEach(() => {
    apiCalls.splice(0, apiCalls.length);
  });

  it('loads current run and recent runs, then starts ingestion', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <Outlet />,
          children: [
            {
              path: 'ingestion',
              element: <IngestionPage />,
              loader: ingestionLoader,
              action: ingestionAction,
            },
          ],
        },
      ],
      { initialEntries: ['/ingestion'] }
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: /Bulk Ingestion/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(apiCalls.some((c) => c.method === 'GET' && c.path === '/bulk/current')).toBe(true);
    });

    await waitFor(() => {
      expect(apiCalls.some((c) => c.method === 'GET' && c.path.startsWith('/bulk?'))).toBe(true);
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Start Full Sync/i }));

    await waitFor(() => {
      expect(apiCalls.some((c) => c.method === 'POST' && c.path === '/bulk/start')).toBe(true);
    });
  });
});
