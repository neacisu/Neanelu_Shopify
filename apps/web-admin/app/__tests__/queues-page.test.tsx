import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import QueuesPage from '../routes/queues';

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

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast,
  Toaster: () => null,
}));

const apiCalls: { method: 'GET' | 'POST' | 'DELETE'; path: string }[] = [];

function createApiStub(): ApiClient {
  return {
    getApi<T>(path: string, init?: RequestInit): Promise<T> {
      const method = ((init?.method ?? 'GET').toUpperCase() as 'GET' | 'DELETE') ?? 'GET';
      apiCalls.push({ method, path });

      if (path === '/queues') {
        return Promise.resolve({
          queues: [
            { name: 'webhooks', waiting: 2, active: 1, delayed: 0, completed: 10, failed: 3 },
            { name: 'token-health', waiting: 0, active: 0, delayed: 0, completed: 1, failed: 0 },
          ],
        } as T);
      }

      if (path.startsWith('/queues/webhooks/metrics')) {
        return Promise.resolve({
          points: [
            {
              ts: 1700000000000,
              timestamp: new Date(1700000000000).toISOString(),
              throughputJobsPerSec: 1.1,
              completedDelta: 2,
              failedDelta: 1,
            },
          ],
        } as T);
      }

      if (path.startsWith('/queues/webhooks/jobs?')) {
        const url = new URL(`http://test.local${path}`);
        const q = url.searchParams.get('q');

        if (q) {
          return Promise.resolve({
            jobs: [
              {
                id: q,
                name: 'job-name',
                timestamp: 1700000000000,
                processedOn: null,
                finishedOn: null,
                attemptsMade: 0,
                attempts: 3,
                progress: 0,
                status: 'waiting',
                payloadPreview: '{"id":123}',
              },
            ],
            total: 1,
            page: Number(url.searchParams.get('page') ?? 0),
            limit: Number(url.searchParams.get('limit') ?? 50),
          } as T);
        }

        return Promise.resolve({
          jobs: [
            {
              id: '1',
              name: 'job-1',
              timestamp: 1700000000000,
              processedOn: null,
              finishedOn: null,
              attemptsMade: 0,
              attempts: 3,
              progress: 0,
              status: 'waiting',
              payloadPreview: '{"id":1}',
            },
          ],
          total: 1,
          page: Number(url.searchParams.get('page') ?? 0),
          limit: Number(url.searchParams.get('limit') ?? 50),
        } as T);
      }

      if (path === '/queues/workers') {
        return Promise.resolve({
          workers: [
            {
              id: 'webhook-worker',
              ok: true,
              pid: 123,
              uptimeSec: 10,
              memoryRssBytes: 1024,
              memoryHeapUsedBytes: 512,
              cpuUserMicros: 1000,
              cpuSystemMicros: 2000,
              currentJob: null,
            },
          ],
        } as T);
      }

      if (path === '/queues/webhooks/jobs/failed' && init?.method === 'DELETE') {
        return Promise.resolve({ removed: 3 } as T);
      }

      if (path.startsWith('/queues/webhooks/jobs/') && path.split('/').length >= 5) {
        const parts = path.split('/');
        const jobId = parts[4] ?? 'unknown';

        if (init?.method === 'DELETE') {
          return Promise.resolve({ ok: true } as T);
        }

        return Promise.resolve({
          job: {
            id: jobId,
            name: 'job-detail',
            state: 'waiting',
            timestamp: 1700000000000,
            processedOn: null,
            finishedOn: null,
            attemptsMade: 0,
            progress: 0,
            failedReason: null,
            stacktrace: [],
            returnvalue: null,
            data: { id: 123, big: 'x' },
            opts: { attempts: 3 },
          },
        } as T);
      }

      return Promise.reject(new Error(`unhandled_get:${path}`));
    },

    postApi<TResponse, TBody extends Record<string, unknown> | FormData>(
      path: string,
      _body: TBody,
      _init?: RequestInit
    ): Promise<TResponse> {
      apiCalls.push({ method: 'POST', path });

      if (path === '/queues/webhooks/pause') {
        return Promise.resolve({ status: 'paused' } as TResponse);
      }

      if (path === '/queues/webhooks/resume') {
        return Promise.resolve({ status: 'resumed' } as TResponse);
      }

      if (path === '/queues/jobs/batch') {
        return Promise.resolve({ ok: true } as TResponse);
      }

      if (path.endsWith('/retry') || path.endsWith('/promote')) {
        return Promise.resolve({ ok: true } as TResponse);
      }

      return Promise.reject(new Error(`unhandled_post:${path}`));
    },
  };
}

vi.mock('../hooks/use-api', () => {
  const api = createApiStub();
  return {
    useApiClient: () => api,
  };
});

vi.mock('../hooks/use-queue-stream', () => ({
  useQueueStream: () => ({ connected: false, error: null }),
}));

describe('Queue Monitor /queues UI', () => {
  beforeEach(() => {
    apiCalls.splice(0, apiCalls.length);
    toast.success.mockReset();
    toast.error.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders overview and loads queues + metrics', async () => {
    render(
      <MemoryRouter initialEntries={['/queues']}>
        <QueuesPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: /Queue Monitor/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(apiCalls.some((c) => c.method === 'GET' && c.path === '/queues')).toBe(true);
    });

    await waitFor(() => {
      expect(
        apiCalls.some((c) => c.method === 'GET' && c.path.startsWith('/queues/webhooks/metrics'))
      ).toBe(true);
    });

    // Snapshot table should show queue names (scope to the snapshot table card).
    const snapshotHeading = await screen.findByText('Queues snapshot');
    const snapshotCard = snapshotHeading.closest('polaris-card');
    expect(snapshotCard).toBeTruthy();

    if (!(snapshotCard instanceof HTMLElement)) {
      throw new Error('Expected snapshot card to be an HTMLElement');
    }

    const snap = within(snapshotCard);
    expect(snap.getByRole('button', { name: 'webhooks' })).toBeInTheDocument();
    expect(snap.getByRole('button', { name: 'token-health' })).toBeInTheDocument();

    // Status distribution chart section should be present.
    expect(await screen.findByText('Status distribution')).toBeInTheDocument();
  });

  it('switches to Jobs tab and searches by job id', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/queues']}>
        <QueuesPage />
      </MemoryRouter>
    );

    // Click Jobs tab (custom element button).
    const jobsBtn = await screen.findByText('Jobs');
    await user.click(jobsBtn.closest('polaris-button') ?? jobsBtn);

    await waitFor(() => {
      expect(
        apiCalls.some((c) => c.method === 'GET' && c.path.startsWith('/queues/webhooks/jobs?'))
      ).toBe(true);
    });

    // Enter search (PolarisTextField renders as <polaris-text-field label="Search" ... />)
    const tf = document.querySelector('polaris-text-field[label="Search"]');
    expect(tf).toBeTruthy();

    if (!(tf instanceof HTMLElement)) {
      throw new Error('Expected search field to be an HTMLElement');
    }

    Object.defineProperty(tf, 'value', {
      value: 'job-xyz',
      writable: true,
      configurable: true,
    });
    fireEvent(tf, new Event('input', { bubbles: true }));

    await waitFor(() => {
      expect(
        apiCalls.some(
          (c) =>
            c.method === 'GET' &&
            c.path.includes('/queues/webhooks/jobs?') &&
            c.path.includes('q=job-xyz')
        )
      ).toBe(true);
    });

    expect(await screen.findByText('job-xyz')).toBeInTheDocument();
  });

  it('opens job details modal and loads job details', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/queues']}>
        <QueuesPage />
      </MemoryRouter>
    );

    const jobsBtn = await screen.findByText('Jobs');
    await user.click(jobsBtn.closest('polaris-button') ?? jobsBtn);

    // Wait for jobs row.
    expect(await screen.findByText('1')).toBeInTheDocument();

    const details = await screen.findByText('Details');
    await user.click(details);

    await waitFor(() => {
      expect(apiCalls.some((c) => c.method === 'GET' && c.path === '/queues/webhooks/jobs/1')).toBe(
        true
      );
    });

    expect(await screen.findByText(/Job details/i)).toBeInTheDocument();
    expect(screen.getByText(/webhooks/i)).toBeInTheDocument();
  });

  it('switches to Workers tab and loads workers', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/queues']}>
        <QueuesPage />
      </MemoryRouter>
    );

    const workersBtn = await screen.findByText('Workers');
    await user.click(workersBtn.closest('polaris-button') ?? workersBtn);

    await waitFor(() => {
      expect(apiCalls.some((c) => c.method === 'GET' && c.path === '/queues/workers')).toBe(true);
    });

    expect(await screen.findByText('webhook-worker')).toBeInTheDocument();
  });

  it('requires confirmation before deleting a job', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/queues']}>
        <QueuesPage />
      </MemoryRouter>
    );

    const jobsBtn = await screen.findByText('Jobs');
    await user.click(jobsBtn.closest('polaris-button') ?? jobsBtn);

    // Wait for jobs row.
    expect(await screen.findByText('1')).toBeInTheDocument();

    // Select the job and click delete selected.
    const checkbox = await screen.findByLabelText('Select job 1');
    await user.click(checkbox);

    const deleteSelected = await screen.findByText('Delete Selected');
    await user.click(deleteSelected.closest('polaris-button') ?? deleteSelected);

    // No DELETE call should happen before confirm.
    expect(
      apiCalls.some((c) => c.method === 'DELETE' && c.path === '/queues/webhooks/jobs/1')
    ).toBe(false);

    // Confirm dialog should appear.
    expect(await screen.findByText(/This action is irreversible\./i)).toBeInTheDocument();
    const confirm = await screen.findByText('Delete job');
    await user.click(confirm.closest('polaris-button') ?? confirm);

    await waitFor(() => {
      expect(
        apiCalls.some((c) => c.method === 'DELETE' && c.path === '/queues/webhooks/jobs/1')
      ).toBe(true);
    });
  });

  it('sets up a 5s auto-refresh interval while Workers tab is active', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/queues']}>
        <QueuesPage />
      </MemoryRouter>
    );

    const workersBtn = await screen.findByText('Workers');
    await user.click(workersBtn.closest('polaris-button') ?? workersBtn);

    await waitFor(() => {
      expect(apiCalls.some((c) => c.method === 'GET' && c.path === '/queues/workers')).toBe(true);
    });

    expect(setIntervalSpy.mock.calls.some((c) => c[1] === 5_000)).toBe(true);

    setIntervalSpy.mockRestore();
  });
});
