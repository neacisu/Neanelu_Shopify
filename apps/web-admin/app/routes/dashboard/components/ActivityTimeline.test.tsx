import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardActivityResponse } from '@app/types';

const useQueryMock = vi.hoisted(() => vi.fn());
const getApiMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

// The component creates its own API client instance.
vi.mock('../../../lib/api-client', () => ({
  createApiClient: () => ({
    getApi: getApiMock,
  }),
}));

vi.mock('../../../lib/session-auth', () => ({
  getSessionAuthHeaders: () => Promise.resolve({}),
}));

import { ActivityTimeline, ActivityTooltipContent } from './ActivityTimeline';

interface UseQueryOptions {
  staleTime?: number;
  refetchInterval?: number;
  queryFn?: () => unknown;
}

describe('ActivityTimeline', () => {
  it('uses max 1 request/min polling (staleTime + refetchInterval)', () => {
    useQueryMock.mockReturnValue({
      isLoading: true,
      isError: false,
      isFetching: false,
      data: undefined,
      error: null,
      refetch: () => Promise.resolve(),
    });

    render(<ActivityTimeline />);

    expect(useQueryMock).toHaveBeenCalledTimes(1);
    const options = useQueryMock.mock.calls[0]?.[0] as unknown as UseQueryOptions | undefined;
    expect(options?.staleTime).toBe(60_000);
    expect(options?.refetchInterval).toBe(60_000);
  });

  it('requests last-7-days activity data from the backend', async () => {
    getApiMock.mockResolvedValueOnce({ days: 7, points: [] } satisfies DashboardActivityResponse);

    useQueryMock.mockReturnValue({
      isLoading: true,
      isError: false,
      isFetching: false,
      data: undefined,
      error: null,
      refetch: () => Promise.resolve(),
    });

    render(<ActivityTimeline />);

    const options = useQueryMock.mock.calls[0]?.[0] as unknown as UseQueryOptions | undefined;
    await options?.queryFn?.();
    expect(getApiMock).toHaveBeenCalledWith('/dashboard/activity?days=7');
  });

  it('renders chart title and loads data points', () => {
    const data: DashboardActivityResponse = {
      days: 7,
      points: [
        {
          date: '2026-01-01',
          timestamp: '2026-01-01T00:00:00.000Z',
          total: 10,
          breakdown: { sync: 1, webhook: 2, bulk: 3, aiBatch: 4 },
        },
      ],
    };

    useQueryMock.mockReturnValue({
      isLoading: false,
      isError: false,
      isFetching: false,
      data,
      error: null,
      refetch: () => Promise.resolve(),
    });

    render(<ActivityTimeline />);
    expect(screen.getByText('Activity Timeline')).toBeInTheDocument();
  });

  it('renders tooltip breakdown (Total/Sync/Webhook/Bulk/AI Batch)', () => {
    const { getByText } = render(
      <ActivityTooltipContent
        active
        payload={[
          {
            payload: {
              date: '2026-01-01',
              total: 10,
              sync: 1,
              webhook: 2,
              bulk: 3,
              aiBatch: 4,
            },
          },
        ]}
      />
    );

    expect(getByText('Total')).toBeInTheDocument();
    expect(getByText('10')).toBeInTheDocument();
    expect(getByText('Sync')).toBeInTheDocument();
    expect(getByText('1')).toBeInTheDocument();
    expect(getByText('Webhook')).toBeInTheDocument();
    expect(getByText('2')).toBeInTheDocument();
    expect(getByText('Bulk')).toBeInTheDocument();
    expect(getByText('3')).toBeInTheDocument();
    expect(getByText('AI Batch')).toBeInTheDocument();
    expect(getByText('4')).toBeInTheDocument();
  });
});
