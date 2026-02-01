import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import SearchPage from '../routes/search';

const getApi = vi.fn((path: string) => {
  if (path.startsWith('/products/filters')) {
    return Promise.resolve({
      vendors: [],
      productTypes: [],
      priceRange: { min: null, max: null },
      categories: [],
    });
  }
  if (path.startsWith('/products/search')) {
    return Promise.resolve({
      results: [],
      query: 'result',
      vectorSearchTimeMs: 12,
      cached: false,
    });
  }
  return Promise.resolve(null);
});

const apiClient = {
  getApi,
  postApi: vi.fn(() => Promise.resolve({ jobId: 'job-1', status: 'queued', estimatedCount: 0 })),
};

vi.mock('../hooks/use-api', () => ({
  useApiClient: () => apiClient,
}));

const recentStore = {
  items: [] as string[],
  entries: [] as { query: string; timestamp: number }[],
  add: vi.fn(),
  clear: vi.fn(),
};

vi.mock('../hooks/use-recent-searches', () => ({
  useRecentSearches: () => recentStore,
}));

describe('SearchPage debounce timing', () => {
  it('delays search calls by 300ms', async () => {
    vi.useFakeTimers();

    render(
      <MemoryRouter initialEntries={['/search']}>
        <SearchPage />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText('Search products...');
    fireEvent.change(input, { target: { value: 'result' } });

    const searchCalls = getApi.mock.calls.filter(([path]) =>
      String(path).startsWith('/products/search')
    );
    expect(searchCalls.length).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    const searchCallsEarly = getApi.mock.calls.filter(([path]) =>
      String(path).startsWith('/products/search')
    );
    expect(searchCallsEarly.length).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    const searchCallsLate = getApi.mock.calls.filter(([path]) =>
      String(path).startsWith('/products/search')
    );
    expect(searchCallsLate.length).toBe(1);

    vi.useRealTimers();
  });
});
