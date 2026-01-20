import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import IngestionSchedulePage, {
  action as scheduleAction,
  loader as scheduleLoader,
} from '../routes/ingestion.schedule';

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

const apiCalls: { method: 'GET' | 'POST' | 'DELETE'; path: string; body?: unknown }[] = [];

function createApiStub(): ApiClient {
  return {
    getApi<T>(path: string, init?: RequestInit): Promise<T> {
      const method = ((init?.method ?? 'GET').toUpperCase() as 'GET' | 'DELETE') ?? 'GET';
      apiCalls.push({ method, path });

      if (path === '/bulk/schedules') {
        return Promise.resolve({
          schedules: [
            {
              id: 'sched-1',
              cron: '0 2 * * *',
              timezone: 'UTC',
              enabled: true,
            },
          ],
        } as T);
      }

      if (path === '/bulk/schedules/sched-1' && method === 'DELETE') {
        return Promise.resolve({ ok: true } as T);
      }

      return Promise.reject(new Error(`unhandled_get:${path}`));
    },

    postApi<TResponse, TBody extends Record<string, unknown> | FormData>(
      path: string,
      body: TBody
    ): Promise<TResponse> {
      apiCalls.push({ method: 'POST', path, body });

      if (path === '/bulk/schedules/sched-1') {
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

describe('Ingestion schedule page', () => {
  beforeEach(() => {
    apiCalls.splice(0, apiCalls.length);
  });

  it('confirms deletion and calls delete endpoint', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <Outlet />,
          children: [
            {
              path: 'ingestion/schedule',
              element: <IngestionSchedulePage />,
              loader: scheduleLoader,
              action: scheduleAction,
            },
          ],
        },
      ],
      { initialEntries: ['/ingestion/schedule'] }
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByText(/Save schedule/i)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete schedule' }));

    const dialog = screen.getByRole('dialog', { name: 'Delete schedule?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(
        apiCalls.some((c) => c.method === 'DELETE' && c.path === '/bulk/schedules/sched-1')
      ).toBe(true);
    });
  });
});
