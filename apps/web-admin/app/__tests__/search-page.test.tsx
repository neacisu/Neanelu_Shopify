import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import SearchPage from '../routes/search';

vi.mock('../hooks/use-debounce', () => ({
  useDebounce: (value: string) => value,
}));

const getApi = vi.fn((path: string) => {
  if (path.startsWith('/products/filters')) {
    return Promise.resolve({
      vendors: ['Nike'],
      productTypes: ['Shoes'],
      priceRange: { min: 10, max: 100 },
      categories: [{ id: 'cat-1', name: 'Footwear' }],
    });
  }
  if (path.startsWith('/products/search')) {
    return Promise.resolve({
      results: [
        {
          id: 'prod-1',
          title: 'Result Product',
          similarity: 0.9,
        },
      ],
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

function LocationSpy({ onChange }: { onChange: (value: string) => void }) {
  const location = useLocation();
  onChange(location.search);
  return null;
}

describe('SearchPage integration', () => {
  it('runs a search after debounce and renders results', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/search']}>
        <SearchPage />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText('Search products...');
    await user.type(input, 'result');

    expect(await screen.findByText('Result Product')).toBeInTheDocument();
  });

  it('initializes from URL and syncs params on change', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];

    render(
      <MemoryRouter
        initialEntries={[
          '/search?q=shoe&limit=30&threshold=0.9&vendors=Nike&productTypes=Shoes&priceMin=10&priceMax=100&categoryId=cat-1',
        ]}
      >
        <SearchPage />
        <LocationSpy onChange={(value) => seen.push(value)} />
      </MemoryRouter>
    );

    const query = screen.getByLabelText('Query');
    expect(query).toHaveValue('shoe');

    const limit = screen.getByLabelText('Limit');
    expect(limit).toHaveValue(30);

    const threshold = screen.getByLabelText(/Threshold/);
    expect(threshold).toHaveValue('0.9');

    fireEvent.change(limit, { target: { value: '50' } });
    await act(async () => {
      await Promise.resolve();
    });

    const last = seen[seen.length - 1] ?? '';
    expect(last).toContain('limit=50');

    fireEvent.change(threshold, { target: { value: '0.8' } });
    await act(async () => {
      await Promise.resolve();
    });

    const lastAfterThreshold = seen[seen.length - 1] ?? '';
    expect(lastAfterThreshold).toContain('threshold=0.8');

    await user.type(query, 's');
    await act(async () => {
      await Promise.resolve();
    });

    const lastAfterQuery = seen[seen.length - 1] ?? '';
    expect(lastAfterQuery).toContain('q=shoes');
  });
});
