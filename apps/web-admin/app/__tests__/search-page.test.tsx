import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import SearchPage from '../routes/search';

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

vi.mock('../hooks/use-api', () => ({
  useApiClient: () => ({ getApi }),
}));

vi.mock('../hooks/use-recent-searches', () => ({
  useRecentSearches: () => ({
    items: [],
    entries: [],
    add: vi.fn(),
    clear: vi.fn(),
  }),
}));

describe('SearchPage integration', () => {
  it('runs a search after debounce and renders results', async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <MemoryRouter initialEntries={['/search']}>
        <SearchPage />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText('Search products...');
    await user.type(input, 'result');

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(await screen.findByText('Result Product')).toBeInTheDocument();
    vi.useRealTimers();
  });
});
