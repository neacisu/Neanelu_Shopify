import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardAlertsResponse } from '@app/types';

const useQueryMock = vi.hoisted(() => vi.fn());

interface UseQueryOptions {
  refetchInterval?: number;
}

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('../../../lib/api-client', () => ({
  createApiClient: () => ({
    getApi: () => Promise.resolve({ alerts: [] } satisfies Partial<DashboardAlertsResponse>),
  }),
}));

vi.mock('../../../lib/session-auth', () => ({
  getSessionAuthHeaders: () => Promise.resolve({}),
}));

describe('SystemAlertsBanner', () => {
  it('polls at max 1/30s and caps to 3 visible alerts', async () => {
    const data: DashboardAlertsResponse = {
      alerts: [
        { id: 'a1', severity: 'warning', title: 'A1', description: 'd1' },
        { id: 'a2', severity: 'warning', title: 'A2', description: 'd2' },
        { id: 'a3', severity: 'critical', title: 'A3', description: 'd3' },
        { id: 'a4', severity: 'critical', title: 'A4', description: 'd4' },
      ],
    };

    useQueryMock.mockReturnValue({
      isLoading: false,
      isError: false,
      isFetching: false,
      data,
      error: null,
    });

    const mod = await import('./SystemAlertsBanner');
    const SystemAlertsBanner = mod.SystemAlertsBanner;

    render(<SystemAlertsBanner />);

    // 3 titles should be present, 4th should be hidden.
    expect(screen.getByText('A1')).toBeInTheDocument();
    expect(screen.getByText('A2')).toBeInTheDocument();
    expect(screen.getByText('A3')).toBeInTheDocument();
    expect(screen.queryByText('A4')).not.toBeInTheDocument();

    expect(useQueryMock).toHaveBeenCalledTimes(1);
    const options = useQueryMock.mock.calls[0]?.[0] as unknown as UseQueryOptions | undefined;
    expect(options?.refetchInterval).toBe(30_000);
  });

  it('dismisses an alert for the current page session, but reappears after refresh (module reload)', async () => {
    sessionStorage.clear();

    const data: DashboardAlertsResponse = {
      alerts: [{ id: 'redis_down', severity: 'critical', title: 'Redis down', description: 'x' }],
    };
    useQueryMock.mockReturnValue({
      isLoading: false,
      isError: false,
      isFetching: false,
      data,
      error: null,
    });

    const mod1 = await import('./SystemAlertsBanner');
    render(<mod1.SystemAlertsBanner />);
    expect(screen.getByText('Redis down')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));
    expect(screen.queryByText('Redis down')).not.toBeInTheDocument();

    // Simulate refresh by resetting modules and importing again.
    vi.resetModules();
    const mod2 = await import('./SystemAlertsBanner');
    render(<mod2.SystemAlertsBanner />);

    expect(screen.getByText('Redis down')).toBeInTheDocument();
  });
});
